"""DEM CRS validation, UTM reprojection, bounding polygon extraction, and ANUGA .dem/.pts export."""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from pyproj import CRS, Transformer
from rasterio.enums import Resampling
from rasterio.features import shapes
from rasterio.transform import Affine
from rasterio.warp import calculate_default_transform, reproject
from shapely.geometry import MultiPolygon, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

logger = logging.getLogger(__name__)

NODATA_OUT = -9999.0
MAX_RASTER_DIM = 800
TARGET_DEFAULT_TRIANGLES = 5500.0
MAX_ALLOWED_TRIANGLES = 50000.0


@dataclass(frozen=True)
class PreparedDem:
    asc_path: Path
    dem_path: Path
    pts_path: Path
    bounding_polygon: list[list[float]]
    utm_epsg: int | None
    utm_zone: int
    hemisphere: str
    cellsize_m: float
    polygon_area_m2: float
    max_triangle_area_m2: float
    min_elevation_m: float
    max_elevation_m: float
    mean_elevation_m: float


def prepare_dem_for_anuga(
    dem_path: Path,
    work_dir: Path,
    requested_max_triangle_area: float | None = None,
) -> PreparedDem:
    """Reproject DEM to metric UTM (if needed), extract valid polygon, and generate ANUGA .dem/.pts."""
    import anuga

    work_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dem_path) as src:
        if src.width < 3 or src.height < 3:
            raise ValueError("DEM raster is too small (must be at least 3x3 pixels).")

        src_crs = _resolve_source_crs(src, dem_path)
        dst_crs, utm_epsg, utm_zone, hemisphere = _target_metric_crs(src, src_crs)
        arr, transform, cellsize = _read_or_warp_metric_square(src, src_crs, dst_crs)

    valid = _valid_mask(arr, NODATA_OUT)
    if int(valid.sum()) < 9:
        raise ValueError("DEM contains too few valid elevation pixels.")

    valid_vals = arr[valid]
    min_elev = float(np.min(valid_vals))
    max_elev = float(np.max(valid_vals))
    mean_elev = float(np.mean(valid_vals))

    bounding_polygon, poly_area = _extract_bounding_polygon(valid, transform, cellsize)
    max_tri_area = _resolve_triangle_area(poly_area, cellsize, requested_max_triangle_area)

    # Fill isolated interior NoData holes near valid pixels so ANUGA vertex interpolation never sees NaN.
    filled = _fill_nodata_nearest(arr, valid)

    asc_path = work_dir / "terrain.asc"
    prj_path = work_dir / "terrain.prj"
    _write_esri_ascii(asc_path, filled, transform, cellsize, NODATA_OUT)
    _write_anuga_prj(prj_path, utm_zone, hemisphere)

    logger.info(
        "Converting %s (%dx%d, cell=%.2fm) to ANUGA .dem/.pts (poly_area=%.0fm2, max_tri=%.1fm2)",
        asc_path.name,
        filled.shape[1],
        filled.shape[0],
        cellsize,
        poly_area,
        max_tri_area,
    )
    anuga.asc2dem(str(asc_path), use_cache=False, verbose=False)
    anuga.dem2pts(str(work_dir / "terrain.dem"), use_cache=False, verbose=False)

    dem_out = work_dir / "terrain.dem"
    pts_out = work_dir / "terrain.pts"
    if not pts_out.is_file():
        raise RuntimeError("ANUGA failed to generate terrain.pts from the DEM.")

    return PreparedDem(
        asc_path=asc_path,
        dem_path=dem_out,
        pts_path=pts_out,
        bounding_polygon=bounding_polygon,
        utm_epsg=utm_epsg,
        utm_zone=utm_zone,
        hemisphere=hemisphere,
        cellsize_m=cellsize,
        polygon_area_m2=poly_area,
        max_triangle_area_m2=max_tri_area,
        min_elevation_m=min_elev,
        max_elevation_m=max_elev,
        mean_elevation_m=mean_elev,
    )


def _resolve_source_crs(src: rasterio.DatasetReader, dem_path: Path) -> CRS | None:
    if src.crs is not None:
        return CRS.from_user_input(src.crs)

    if dem_path.suffix.lower() == ".asc":
        bounds = src.bounds
        looks_geographic = (
            -180.0 <= bounds.left <= 180.0
            and -180.0 <= bounds.right <= 180.0
            and -90.0 <= bounds.bottom <= 90.0
            and -90.0 <= bounds.top <= 90.0
            and abs(bounds.right - bounds.left) <= 10.0
            and abs(bounds.top - bounds.bottom) <= 10.0
        )
        if looks_geographic:
            logger.warning("ASCII DEM has no CRS; bounds look geographic, assuming EPSG:4326.")
            return CRS.from_epsg(4326)
        logger.warning("ASCII DEM has no CRS; assuming local metric coordinates in meters.")
        return None

    raise ValueError(
        "The uploaded GeoTIFF has no CRS metadata. Re-export with a valid CRS (e.g. EPSG:4326 or UTM)."
    )


def _target_metric_crs(
    src: rasterio.DatasetReader,
    src_crs: CRS | None,
) -> tuple[CRS | None, int | None, int, str]:
    if src_crs is None:
        return None, None, 51, "northern"

    is_metric = (not src_crs.is_geographic) and _is_meter_units(src_crs)
    cx = (src.bounds.left + src.bounds.right) / 2.0
    cy = (src.bounds.bottom + src.bounds.top) / 2.0
    to_wgs = Transformer.from_crs(src_crs, "EPSG:4326", always_xy=True)
    lon, lat = to_wgs.transform(cx, cy)
    if not (math.isfinite(lon) and math.isfinite(lat)):
        raise ValueError("Could not project DEM centroid to WGS84.")
    zone = min(60, max(1, int((float(lon) + 180.0) // 6) + 1))
    hemisphere = "northern" if lat >= 0 else "southern"

    if is_metric:
        epsg = src_crs.to_epsg()
        return src_crs, epsg, zone, hemisphere

    utm_epsg = (32600 if lat >= 0 else 32700) + zone
    logger.info("Reprojecting DEM from %s to metric UTM EPSG:%d", src_crs.to_string(), utm_epsg)
    return CRS.from_epsg(utm_epsg), utm_epsg, zone, hemisphere


def _is_meter_units(crs: CRS) -> bool:
    try:
        axis_info = crs.axis_info
        if axis_info and axis_info[0].unit_conversion_factor:
            return abs(float(axis_info[0].unit_conversion_factor) - 1.0) < 1e-3
    except Exception:
        pass
    return False


def _read_or_warp_metric_square(
    src: rasterio.DatasetReader,
    src_crs: CRS | None,
    dst_crs: CRS | None,
) -> tuple[np.ndarray, Affine, float]:
    src_nodata = src.nodata

    if src_crs is None or dst_crs is None:
        data = src.read(1).astype(np.float32)
        valid = _valid_mask(data, src_nodata)
        data = np.where(valid, data, NODATA_OUT).astype(np.float32)
        cellsize = float((abs(src.transform.a) + abs(src.transform.e)) / 2.0)
        if cellsize <= 0:
            raise ValueError("DEM has invalid pixel size.")
        if max(src.width, src.height) > MAX_RASTER_DIM:
            scale = max(src.width, src.height) / float(MAX_RASTER_DIM)
            new_w = max(3, int(round(src.width / scale)))
            new_h = max(3, int(round(src.height / scale)))
            data = src.read(1, out_shape=(new_h, new_w), resampling=Resampling.bilinear).astype(np.float32)
            valid = _valid_mask(data, src_nodata)
            data = np.where(valid, data, NODATA_OUT).astype(np.float32)
            cellsize = float(max(src.bounds.right - src.bounds.left, src.bounds.top - src.bounds.bottom) / max(new_w, new_h))
            transform = Affine(cellsize, 0.0, src.bounds.left, 0.0, -cellsize, src.bounds.top)
            return data, transform, cellsize
        transform = Affine(cellsize, 0.0, src.bounds.left, 0.0, -cellsize, src.bounds.top)
        return data, transform, cellsize

    base_transform, base_w, base_h = calculate_default_transform(
        src_crs, dst_crs, src.width, src.height, *src.bounds
    )
    native_res = max(abs(base_transform.a), abs(base_transform.e))
    if not math.isfinite(native_res) or native_res <= 0:
        raise ValueError("Could not determine metric pixel resolution for DEM.")

    max_dim = max(base_w, base_h)
    if max_dim > MAX_RASTER_DIM:
        cellsize = native_res * (max_dim / float(MAX_RASTER_DIM))
    else:
        cellsize = native_res

    dst_transform, dst_w, dst_h = calculate_default_transform(
        src_crs,
        dst_crs,
        src.width,
        src.height,
        *src.bounds,
        resolution=(cellsize, cellsize),
    )

    src_band = src.read(1).astype(np.float32)
    src_valid = _valid_mask(src_band, src_nodata)
    src_clean = np.where(src_valid, src_band, NODATA_OUT).astype(np.float32)

    dst_band = np.full((dst_h, dst_w), NODATA_OUT, dtype=np.float32)
    reproject(
        source=src_clean,
        destination=dst_band,
        src_transform=src.transform,
        src_crs=src_crs,
        src_nodata=NODATA_OUT,
        dst_transform=dst_transform,
        dst_crs=dst_crs,
        dst_nodata=NODATA_OUT,
        resampling=Resampling.bilinear,
    )
    return dst_band, dst_transform, float(cellsize)


def _valid_mask(values: np.ndarray, nodata: float | None) -> np.ndarray:
    mask = np.isfinite(values)
    if nodata is not None and math.isfinite(float(nodata)):
        mask &= np.abs(values - float(nodata)) > 1e-3
    mask &= values > -1.0e5
    return mask


def _extract_bounding_polygon(
    valid: np.ndarray,
    transform: Affine,
    cellsize: float,
) -> tuple[list[list[float]], float]:
    geoms = [
        shape(geom)
        for geom, val in shapes(valid.astype(np.uint8), mask=valid, transform=transform)
        if val == 1
    ]
    if not geoms:
        raise ValueError("Could not extract a valid data polygon from the DEM.")

    merged = unary_union(geoms)
    if isinstance(merged, MultiPolygon):
        poly = max(merged.geoms, key=lambda g: g.area)
    elif isinstance(merged, Polygon):
        poly = merged
    else:
        raise ValueError("DEM valid footprint did not form a polygon.")

    # Use clean rectangle when valid data fills almost the entire bounding box.
    minx, miny, maxx, maxy = poly.bounds
    bbox_poly = box(minx, miny, maxx, maxy)
    fill_ratio = poly.area / max(bbox_poly.area, 1e-6)

    inset = cellsize * 0.75
    if fill_ratio >= 0.96 and (maxx - minx) > 4 * inset and (maxy - miny) > 4 * inset:
        candidate = box(minx + inset, miny + inset, maxx - inset, maxy - inset)
    else:
        shrunk = poly.buffer(-inset)
        if isinstance(shrunk, MultiPolygon):
            shrunk = max(shrunk.geoms, key=lambda g: g.area)
        candidate = shrunk if isinstance(shrunk, Polygon) and not shrunk.is_empty else poly
        tol = max(cellsize * 1.5, math.sqrt(candidate.area) * 0.008)
        simplified = candidate.simplify(tol, preserve_topology=True)
        if isinstance(simplified, Polygon) and not simplified.is_empty and len(simplified.exterior.coords) >= 4:
            candidate = simplified

    candidate = orient(candidate, sign=1.0)
    coords = [[float(x), float(y)] for x, y in list(candidate.exterior.coords)[:-1]]
    if len(coords) < 3:
        raise ValueError("Extracted DEM bounding polygon has fewer than 3 vertices.")
    return coords, float(candidate.area)


def _resolve_triangle_area(
    poly_area_m2: float,
    cellsize: float,
    requested: float | None,
) -> float:
    min_safe = max(cellsize * cellsize * 0.25, poly_area_m2 / MAX_ALLOWED_TRIANGLES)
    if requested is None or requested <= 0:
        default_area = poly_area_m2 / TARGET_DEFAULT_TRIANGLES
        return float(max(min_safe, default_area))

    if poly_area_m2 / requested > MAX_ALLOWED_TRIANGLES:
        raise ValueError(
            f"Requested max_triangle_area ({requested:.1f} m²) would exceed "
            f"{int(MAX_ALLOWED_TRIANGLES):,} triangles for this {poly_area_m2 / 1e6:.2f} km² DEM. "
            f"Increase max_triangle_area to at least {min_safe:.0f} m²."
        )
    return float(requested)


def _fill_nodata_nearest(arr: np.ndarray, valid: np.ndarray) -> np.ndarray:
    if np.all(valid):
        return arr
    out = arr.astype(np.float32, copy=True)
    known = valid.copy()
    # Dilate valid values outward for a few passes so boundary triangles never interpolate NoData.
    for _ in range(16):
        if np.all(known):
            break
        padded_val = np.pad(out, 1, mode="edge")
        padded_ok = np.pad(known, 1, mode="constant", constant_values=False)
        acc = np.zeros_like(out, dtype=np.float64)
        cnt = np.zeros_like(out, dtype=np.int32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ok_slice = padded_ok[1 + dy : 1 + dy + out.shape[0], 1 + dx : 1 + dx + out.shape[1]]
                val_slice = padded_val[1 + dy : 1 + dy + out.shape[0], 1 + dx : 1 + dx + out.shape[1]]
                acc += np.where(ok_slice, val_slice, 0.0)
                cnt += ok_slice.astype(np.int32)
        fill_now = (~known) & (cnt > 0)
        if not np.any(fill_now):
            break
        out[fill_now] = (acc[fill_now] / cnt[fill_now]).astype(np.float32)
        known[fill_now] = True

    if not np.all(known):
        fallback = float(np.median(arr[valid]))
        out[~known] = fallback
    return out


def _write_esri_ascii(
    path: Path,
    arr: np.ndarray,
    transform: Affine,
    cellsize: float,
    nodata: float,
) -> None:
    nrows, ncols = arr.shape
    xllcorner = float(transform.c)
    yllcorner = float(transform.f - nrows * cellsize)
    header = (
        f"ncols         {ncols}\n"
        f"nrows         {nrows}\n"
        f"xllcorner     {xllcorner:.6f}\n"
        f"yllcorner     {yllcorner:.6f}\n"
        f"cellsize      {cellsize:.6f}\n"
        f"NODATA_value  {nodata:.1f}\n"
    )
    with path.open("w", encoding="utf-8") as handle:
        handle.write(header)
        np.savetxt(handle, arr, fmt="%.3f")


def _write_anuga_prj(path: Path, utm_zone: int, hemisphere: str) -> None:
    content = (
        "Projection    UTM\n"
        f"Zone          {utm_zone}\n"
        "Datum         WGS84\n"
        "Zunits        NO\n"
        "Units         METERS\n"
        "Spheroid      WGS84\n"
        "Xshift        0.0000000000\n"
        "Yshift        0.0000000000\n"
        "Parameters\n"
    )
    path.write_text(content, encoding="utf-8")
