"""Write a single-band float32 Cloud Optimized GeoTIFF of HAND.

The working grid stays in the source CRS. The served raster is reprojected
to EPSG:3857 (EPSG:4326 if that warp fails) so MapLibre can drape it.
Nearest-neighbor resampling keeps HAND magnitudes and NoData intact.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.transform import array_bounds
from rasterio.warp import calculate_default_transform, reproject
from rio_cogeo.cogeo import cog_translate
from rio_cogeo.profiles import cog_profiles

NODATA = -9999.0


def write_hand_cog(
    hand: np.ndarray,
    crs,
    transform,
    out_path: Path,
) -> tuple[str, list[float]]:
    """Write hand_cog.tif. Returns the output CRS and WGS84 bbox."""
    grid = np.asarray(hand, dtype=np.float32)
    export = np.where(np.isfinite(grid), grid, NODATA).astype(np.float32)
    height, width = export.shape
    src_path = out_path.with_suffix(".src.tif")
    warp_path = out_path.with_suffix(".warp.tif")
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": NODATA,
    }
    try:
        with rasterio.open(src_path, "w", **profile) as dst:
            dst.write(export, 1)
        used = _warp(src_path, warp_path, "EPSG:3857")
        if used is None:
            used = _warp(src_path, warp_path, "EPSG:4326")
        if used is None:
            raise RuntimeError("Could not reproject HAND into EPSG:3857 or EPSG:4326.")
        cog_profile = cog_profiles.get("deflate")
        cog_translate(
            warp_path,
            out_path,
            cog_profile,
            nodata=NODATA,
            dtype="float32",
            resampling="nearest",
            overview_resampling="nearest",
            quiet=True,
            in_memory=True,
        )
        bbox = _wgs84_bounds(out_path)
        return used, bbox
    finally:
        src_path.unlink(missing_ok=True)
        warp_path.unlink(missing_ok=True)


def _warp(src_path: Path, dst_path: Path, dst_crs: str) -> str | None:
    try:
        with rasterio.open(src_path) as src:
            transform, width, height = calculate_default_transform(
                src.crs, dst_crs, src.width, src.height, *src.bounds
            )
            dest = np.full((height, width), NODATA, dtype=np.float32)
            reproject(
                source=rasterio.band(src, 1),
                destination=dest,
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=NODATA,
                dst_transform=transform,
                dst_crs=dst_crs,
                dst_nodata=NODATA,
                resampling=Resampling.nearest,
            )
            profile = {
                "driver": "GTiff",
                "crs": dst_crs,
                "transform": transform,
                "width": width,
                "height": height,
                "dtype": "float32",
                "nodata": NODATA,
                "count": 1,
                "compress": "deflate",
            }
        if dst_path.exists():
            dst_path.unlink()
        with rasterio.open(dst_path, "w", **profile) as dst:
            dst.write(dest, 1)
        return dst_crs
    except Exception:
        if dst_path.exists():
            dst_path.unlink()
        return None


def _wgs84_bounds(path: Path) -> list[float]:
    with rasterio.open(path) as src:
        left, bottom, right, top = array_bounds(src.height, src.width, src.transform)
        xs = [left, right, left, right]
        ys = [bottom, bottom, top, top]
        to_wgs = rasterio.warp.transform(src.crs, CRS.from_epsg(4326), xs, ys)
    lons, lats = to_wgs
    return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]
