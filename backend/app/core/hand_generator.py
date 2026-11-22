"""HAND from a DEM, or a pass-through when the upload is already HAND.

The DEM path follows the reference notebook:

1. fill pits
2. fill depressions
3. resolve flats
4. D8 flow direction
5. D8 flow accumulation
6. streams where accumulation >= the drainage threshold
7. HAND(c) = Z(c) − Z(stream reached by following flow from c)

pysheds runs those steps when it imports. NumPy 2 removed ``np.in1d``, which
pysheds 0.5 still calls, so that name is aliased to ``np.isin`` before import.
If pysheds is missing or fails, the same seven steps run in NumPy.

The accumulation threshold is in cells. Callers pass a drainage area in km²
and this module converts it with the centroid UTM pixel area (Δx · Δy).
It does not subsample the scene: every pixel in the selected window is used.
Windows are capped at 512×512.
"""

from __future__ import annotations

import json
import logging
import math
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import Affine, array_bounds
from rasterio.windows import Window

from app.core.cog_exporter import NODATA, write_hand_cog
from app.core.hypsometric import DH_M, H_MAX_M, build_hypsometric
from app.core.storage import DATA_DIR, dataset_dir, incoming_dir

logger = logging.getLogger(__name__)

MAX_SCENE = 512
_DIRS = (
    (-1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
)
_DIST = tuple(math.hypot(di, dj) for di, dj in _DIRS)


class NoStreamError(ValueError):
    """The accumulation threshold is above every cell in the window."""


@dataclass(frozen=True)
class SceneWindow:
    col: int
    row: int
    width: int
    height: int

    def as_dict(self) -> dict[str, int]:
        return {
            "col": self.col,
            "row": self.row,
            "width": self.width,
            "height": self.height,
        }


def needs_crop(width: int, height: int) -> bool:
    return width > MAX_SCENE or height > MAX_SCENE


def suggest_window(width: int, height: int) -> SceneWindow:
    win_w = min(width, MAX_SCENE)
    win_h = min(height, MAX_SCENE)
    return SceneWindow(
        col=max(0, (width - win_w) // 2),
        row=max(0, (height - win_h) // 2),
        width=win_w,
        height=win_h,
    )


def resolve_window(width: int, height: int, window: SceneWindow | None) -> SceneWindow:
    if window is None:
        if needs_crop(width, height):
            raise ValueError(
                f"This raster is {width}×{height}. A scene can be at most "
                f"{MAX_SCENE}×{MAX_SCENE} pixels, so choose a window. "
                "Rasters already within that limit are computed in full."
            )
        return SceneWindow(0, 0, width, height)
    if window.width < 1 or window.height < 1:
        raise ValueError("Crop window is empty.")
    if window.width > MAX_SCENE or window.height > MAX_SCENE:
        raise ValueError(
            f"Crop window cannot exceed {MAX_SCENE}×{MAX_SCENE} pixels."
        )
    if (
        window.col < 0
        or window.row < 0
        or window.col + window.width > width
        or window.row + window.height > height
    ):
        raise ValueError("Crop window sits outside the raster.")
    return window


def accum_cells_from_area(dx_m: float, dy_m: float, threshold_km2: float) -> float:
    if threshold_km2 <= 0:
        raise ValueError("Drainage-area threshold must be greater than 0.")
    area = dx_m * dy_m
    if area <= 0:
        raise ValueError("Pixel area must be positive.")
    return max(1.0, (threshold_km2 * 1_000_000.0) / area)


def resolve_accum_cells(
    dx_m: float,
    dy_m: float,
    threshold_km2: float,
    accum_threshold_cells: float | None,
) -> float:
    if accum_threshold_cells is None:
        return accum_cells_from_area(dx_m, dy_m, threshold_km2)
    cells = float(accum_threshold_cells)
    if cells < 1:
        raise ValueError("Pixel accumulation threshold must be at least 1 cell.")
    return cells


def metric_pixel_size(crs, transform: Affine, width: int, height: int):
    """UTM zone of the raster centroid, and ground size of one pixel in meters."""
    if crs is None:
        raise ValueError(
            "The GeoTIFF has no CRS, so pixel area and the map position cannot be computed."
        )
    cx = transform.c + transform.a * (width / 2.0) + transform.b * (height / 2.0)
    cy = transform.f + transform.d * (width / 2.0) + transform.e * (height / 2.0)
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon, lat = to_wgs.transform(cx, cy)
    zone = int((float(lon) + 180.0) // 6) + 1
    zone = min(60, max(1, zone))
    epsg = (32600 if lat >= 0 else 32700) + zone
    to_utm = Transformer.from_crs(crs, f"EPSG:{epsg}", always_xy=True)
    x0, y0 = to_utm.transform(cx, cy)
    x_col, y_col = to_utm.transform(cx + transform.a, cy + transform.d)
    x_row, y_row = to_utm.transform(cx + transform.b, cy + transform.e)
    dx = math.hypot(x_col - x0, y_col - y0)
    dy = math.hypot(x_row - x0, y_row - y0)
    if dx <= 0 or dy <= 0:
        raise ValueError("Could not measure a metric pixel size for this raster.")
    return float(dx), float(dy), int(epsg), float(lon), float(lat)


def wgs84_bounds(crs, transform: Affine, width: int, height: int) -> list[float]:
    left, bottom, right, top = array_bounds(height, width, transform)
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lons, lats = to_wgs.transform(
        [left, right, left, right],
        [bottom, bottom, top, top],
    )
    return [float(min(lons)), float(min(lats)), float(max(lons)), float(max(lats))]


def _valid_mask(values: np.ndarray, nodata) -> np.ndarray:
    mask = np.isfinite(values)
    if nodata is not None and np.isfinite(nodata):
        mask &= values != np.float64(nodata)
    mask &= values > -1.0e6
    return mask


def inspect_upload(
    src_path: Path,
    upload_id: str,
    source_name: str,
    stream_threshold_km2: float,
) -> dict:
    preview_path = incoming_dir(upload_id) / "preview.png"
    with rasterio.open(src_path) as src:
        width, height = src.width, src.height
        if src.crs is None:
            raise ValueError(
                "The GeoTIFF has no CRS, so pixel area and the map position cannot be computed."
            )
        dx, dy, utm_epsg, _lon, _lat = metric_pixel_size(
            src.crs, src.transform, width, height
        )
        bbox = wgs84_bounds(src.crs, src.transform, width, height)
        nodata = src.nodata
        scale = min(1.0, 720.0 / max(width, height))
        preview_w = max(1, int(round(width * scale)))
        preview_h = max(1, int(round(height * scale)))
        band = src.read(
            1,
            out_shape=(preview_h, preview_w),
            resampling=Resampling.bilinear,
        )
    _write_preview(band, nodata, preview_path)
    cells = accum_cells_from_area(dx, dy, stream_threshold_km2)
    window = suggest_window(width, height)
    return {
        "upload_id": upload_id,
        "source_name": source_name,
        "width": width,
        "height": height,
        "needs_crop": needs_crop(width, height),
        "max_scene": MAX_SCENE,
        "suggested_window": window.as_dict(),
        "dx_m": dx,
        "dy_m": dy,
        "utm_epsg": utm_epsg,
        "bbox": bbox,
        "pixel_area_m2": dx * dy,
        "accum_threshold_cells": cells,
        "stream_threshold_km2": stream_threshold_km2,
        "preview_url": f"/api/uploads/{upload_id}/preview",
    }


def _write_preview(band: np.ndarray, nodata, path: Path) -> None:
    values = np.asarray(band, dtype=np.float64)
    valid = _valid_mask(values, nodata)
    image = np.zeros((*values.shape, 4), dtype=np.uint8)
    if np.any(valid):
        lo, hi = np.percentile(values[valid], [2, 98])
        if not np.isfinite(lo) or not np.isfinite(hi) or hi <= lo:
            hi = lo + 1.0
        tone = np.clip((values - lo) / (hi - lo), 0.0, 1.0)
        image[..., 0] = (78 + tone * 150).astype(np.uint8)
        image[..., 1] = (108 + (1.0 - tone) * 36 + tone * 70).astype(np.uint8)
        image[..., 2] = (72 + (1.0 - tone) * 24).astype(np.uint8)
        image[..., 3] = np.where(valid, 255, 0).astype(np.uint8)
    Image.fromarray(image, mode="RGBA").save(path, format="PNG")


def process_raster(
    src_path: Path,
    out_dir: Path,
    *,
    dataset_id: str,
    source_kind: str,
    source_name: str,
    window: SceneWindow | None,
    stream_threshold_km2: float,
    accum_threshold_cells: float | None,
) -> dict:
    """Read one window, build HAND if needed, and write the dataset files."""
    out_dir.mkdir(parents=True, exist_ok=True)
    with rasterio.open(src_path) as src:
        if src.crs is None:
            raise ValueError(
                "The GeoTIFF has no CRS, so pixel area and the map position cannot be computed."
            )
        chosen = resolve_window(src.width, src.height, window)
        raster_window = Window(chosen.col, chosen.row, chosen.width, chosen.height)
        values = src.read(1, window=raster_window).astype(np.float64)
        transform = src.window_transform(raster_window)
        crs = src.crs
        nodata = src.nodata
        source_width, source_height = src.width, src.height

    valid = _valid_mask(values, nodata)
    if not np.any(valid):
        raise ValueError("The selected window has no valid elevation pixels.")
    dx, dy, utm_epsg, _lon, _lat = metric_pixel_size(
        crs, transform, chosen.width, chosen.height
    )
    cells: float | None = None
    used_km2: float | None = None
    if source_kind == "dem":
        cells = resolve_accum_cells(
            dx, dy, stream_threshold_km2, accum_threshold_cells
        )
        used_km2 = cells * dx * dy / 1_000_000.0
        hand, engine = _hand_for_dem(values, valid, crs, transform, cells, dx, dy)
    elif source_kind in {"hand", "sample"}:
        hand = np.where(valid, np.maximum(values, 0.0), np.nan).astype(np.float32)
        engine = "uploaded_hand" if source_kind == "hand" else "sample"
        used_km2 = stream_threshold_km2
    else:
        raise ValueError("kind must be 'hand' or 'dem'.")

    finite = np.isfinite(hand) & (hand >= 0)
    if not np.any(finite):
        raise ValueError("HAND has no usable pixels in this window.")

    curve = build_hypsometric(hand, finite, dx, dy)
    cog_path = out_dir / "hand_cog.tif"
    cog_crs, bbox = write_hand_cog(hand, crs, transform, cog_path)
    payload = {
        "dataset_id": dataset_id,
        "source_kind": source_kind,
        "source_name": source_name,
        "bbox": bbox,
        "crs": cog_crs,
        "a_basin_m2": curve["a_basin_m2"],
        "stages_m": curve["stages_m"],
        "areas_m2": curve["areas_m2"],
        "volumes_m3": curve["volumes_m3"],
        "dx_m": dx,
        "dy_m": dy,
        "pixel_area_m2": curve["pixel_area_m2"],
        "utm_epsg": utm_epsg,
        "stream_threshold_km2": used_km2,
        "accum_threshold_cells": cells,
        "hand_engine": engine,
        "nodata": NODATA,
        "width": chosen.width,
        "height": chosen.height,
        "dh_m": DH_M,
        "h_max_m": H_MAX_M,
        "scene": {
            "source_width": source_width,
            "source_height": source_height,
            "col": chosen.col,
            "row": chosen.row,
            "width": chosen.width,
            "height": chosen.height,
            "max_scene": MAX_SCENE,
        },
    }
    (out_dir / "hypsometric.json").write_text(json.dumps(payload), encoding="utf-8")
    logger.info(
        "dataset %s engine=%s window=%sx%s%s",
        dataset_id,
        engine,
        chosen.width,
        chosen.height,
        f" cells>={cells:.0f}" if cells is not None else "",
    )
    return payload


def _hand_for_dem(
    values, valid, crs, transform, cells: float, dx: float, dy: float
) -> tuple[np.ndarray, str]:
    count = int(valid.sum())
    if cells > count:
        area_km2 = count * dx * dy / 1_000_000.0
        need_km2 = cells * dx * dy / 1_000_000.0
        raise NoStreamError(
            f"This window covers {area_km2:.3f} km² ({count} cells). "
            f"The accumulation threshold is {cells:.0f} cells ({need_km2:.3f} km²), "
            "which is larger than the window, so no stream can form. "
            "Lower the drainage-area or pixel accumulation threshold."
        )
    tmp = DATA_DIR / "_work" / f"{uuid.uuid4().hex}.tif"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    export = np.where(valid, values, NODATA).astype(np.float32)
    profile = {
        "driver": "GTiff",
        "height": export.shape[0],
        "width": export.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": NODATA,
    }
    try:
        with rasterio.open(tmp, "w", **profile) as dst:
            dst.write(export, 1)
        try:
            hand = _hand_pysheds(tmp, cells)
            return hand, "pysheds"
        except NoStreamError:
            raise
        except Exception as exc:
            logger.warning("pysheds HAND failed (%s); using built-in D8", exc)
            return compute_hand_builtin(values, valid, cells), "builtin_d8"
    finally:
        tmp.unlink(missing_ok=True)


def _import_grid():
    import numpy as _np

    if not hasattr(_np, "in1d"):
        # pysheds 0.5 still calls the NumPy 1 alias removed in NumPy 2.
        _np.in1d = _np.isin  # type: ignore[attr-defined]
    from pysheds.grid import Grid

    return Grid


def _hand_pysheds(dem_path: Path, accum_cells: float) -> np.ndarray:
    grid_cls = _import_grid()
    grid = grid_cls.from_raster(str(dem_path))
    dem = grid.read_raster(str(dem_path))
    dem = grid.fill_pits(dem)
    dem = grid.fill_depressions(dem)
    dem = grid.resolve_flats(dem)
    fdir = grid.flowdir(dem, routing="d8")
    acc = grid.accumulation(fdir, routing="d8")
    acc_arr = np.asarray(acc, dtype=np.float64)
    if not np.any(np.isfinite(acc_arr) & (acc_arr >= accum_cells)):
        raise NoStreamError(_no_stream_message(acc_arr, accum_cells))
    streams = acc >= accum_cells
    hand = grid.compute_hand(fdir, dem, streams, routing="d8")
    out = np.asarray(hand, dtype=np.float64)
    nodata = getattr(hand, "nodata", None)
    valid = np.isfinite(out)
    if nodata is not None and np.isfinite(nodata):
        valid &= out != nodata
    result = np.full(out.shape, np.nan, dtype=np.float32)
    result[valid] = np.maximum(out[valid], 0.0).astype(np.float32)
    return result


def compute_hand_builtin(
    dem: np.ndarray,
    valid: np.ndarray,
    accum_cells: float,
) -> np.ndarray:
    """Same conditioning sequence as pysheds, in NumPy, for when pysheds is absent."""
    elevation = condition_dem(np.asarray(dem, dtype=np.float64), valid)
    fdir = d8_flow(elevation, valid)
    acc, down_i, down_j, order = accumulate(fdir, valid)
    if not np.any(valid & (acc >= accum_cells)):
        raise NoStreamError(_no_stream_message(acc, accum_cells))
    return hand_from_flow(elevation, valid, acc, down_i, down_j, order, accum_cells)


def condition_dem(dem: np.ndarray, valid: np.ndarray) -> np.ndarray:
    filled = fill_pits(dem, valid)
    filled = fill_depressions(filled, valid)
    return resolve_flats(filled, valid)


def fill_pits(dem: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Raise one-cell pits to the lowest neighbor, matching pysheds fill_pits."""
    height, width = dem.shape
    surface = np.where(valid, dem, np.inf)
    padded = np.pad(surface, 1, constant_values=np.inf)
    lowest = np.full(dem.shape, np.inf)
    for di, dj in _DIRS:
        lowest = np.minimum(lowest, padded[1 + di : 1 + di + height, 1 + dj : 1 + dj + width])
    out = np.array(dem, dtype=np.float64, copy=True)
    pits = valid & np.isfinite(dem) & (dem < lowest)
    out[pits] = lowest[pits]
    return out


def fill_depressions(dem: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """Priority-flood. Interior sinks are raised to the spill elevation."""
    import heapq

    height, width = dem.shape
    filled = np.array(dem, dtype=np.float64, copy=True)
    visited = ~np.asarray(valid, dtype=bool)
    heap: list[tuple[float, int, int]] = []
    for i in range(height):
        for j in range(width):
            if not valid[i, j]:
                continue
            if _on_edge(valid, i, j):
                visited[i, j] = True
                heapq.heappush(heap, (float(filled[i, j]), i, j))
    while heap:
        elevation, i, j = heapq.heappop(heap)
        for di, dj in _DIRS:
            ni = i + di
            nj = j + dj
            if ni < 0 or nj < 0 or ni >= height or nj >= width or visited[ni, nj]:
                continue
            visited[ni, nj] = True
            if filled[ni, nj] < elevation:
                filled[ni, nj] = elevation
            heapq.heappush(heap, (float(filled[ni, nj]), ni, nj))
    return filled


def resolve_flats(dem: np.ndarray, valid: np.ndarray, eps: float = 1e-3) -> np.ndarray:
    """Give flat cells a millimeter-scale slope toward a lower neighbor."""
    from collections import deque

    height, width = dem.shape
    fdir = d8_flow(dem, valid)
    unresolved = valid & (fdir < 0)
    # A cell that can already step downhill is not a flat, even at a border.
    # Unresolved cells are flats or outlets. Outlets that touch a lower cell,
    # or the data edge, are the pour points.
    dist = np.full(dem.shape, -1, dtype=np.int32)
    queue: deque[tuple[int, int]] = deque()
    for i, j in np.argwhere(unresolved):
        i = int(i)
        j = int(j)
        if _touches_lower(dem, valid, i, j) or _on_edge(valid, i, j):
            dist[i, j] = 0
            queue.append((i, j))
    while queue:
        i, j = queue.popleft()
        for di, dj in _DIRS:
            ni = i + di
            nj = j + dj
            if ni < 0 or nj < 0 or ni >= height or nj >= width:
                continue
            if unresolved[ni, nj] and dist[ni, nj] < 0:
                dist[ni, nj] = dist[i, j] + 1
                queue.append((ni, nj))
    out = np.array(dem, dtype=np.float64, copy=True)
    lift = unresolved & (dist > 0)
    out[lift] = out[lift] + eps * dist[lift]
    return out


def d8_flow(dem: np.ndarray, valid: np.ndarray) -> np.ndarray:
    height, width = dem.shape
    surface = np.where(valid, dem, np.inf)
    padded = np.pad(surface, 1, constant_values=np.inf)
    valid_pad = np.pad(valid, 1, constant_values=False)
    best = np.full(dem.shape, -np.inf)
    fdir = np.full(dem.shape, -1, dtype=np.int16)
    for code, ((di, dj), dist) in enumerate(zip(_DIRS, _DIST)):
        neighbor = padded[1 + di : 1 + di + height, 1 + dj : 1 + dj + width]
        neighbor_ok = valid_pad[1 + di : 1 + di + height, 1 + dj : 1 + dj + width]
        slope = (dem - neighbor) / dist
        slope = np.where(valid & neighbor_ok, slope, -np.inf)
        take = slope > best
        best = np.where(take, slope, best)
        fdir = np.where(take, code, fdir)
    return np.where(valid & (best > 0), fdir, -1).astype(np.int16)


def accumulate(fdir: np.ndarray, valid: np.ndarray):
    from collections import deque

    height, width = fdir.shape
    down_i = np.full(fdir.shape, -1, dtype=np.int32)
    down_j = np.full(fdir.shape, -1, dtype=np.int32)
    indegree = np.zeros(fdir.shape, dtype=np.int32)
    cells = np.argwhere(valid)
    for i, j in cells:
        i = int(i)
        j = int(j)
        code = int(fdir[i, j])
        if code < 0:
            continue
        di, dj = _DIRS[code]
        ni = i + di
        nj = j + dj
        if 0 <= ni < height and 0 <= nj < width and valid[ni, nj]:
            down_i[i, j] = ni
            down_j[i, j] = nj
            indegree[ni, nj] += 1
    acc = np.zeros(fdir.shape, dtype=np.float64)
    acc[valid] = 1.0
    queue: deque[tuple[int, int]] = deque()
    for i, j in cells:
        i = int(i)
        j = int(j)
        if indegree[i, j] == 0:
            queue.append((i, j))
    order: list[tuple[int, int]] = []
    while queue:
        i, j = queue.popleft()
        order.append((i, j))
        ni = int(down_i[i, j])
        nj = int(down_j[i, j])
        if ni >= 0:
            acc[ni, nj] += acc[i, j]
            indegree[ni, nj] -= 1
            if indegree[ni, nj] == 0:
                queue.append((ni, nj))
    return acc, down_i, down_j, order


def hand_from_flow(elevation, valid, acc, down_i, down_j, order, accum_cells: float):
    """HAND(c) = Z(c) − Z(first stream cell downstream of c)."""
    streams = valid & (acc >= accum_cells)
    stream_z = np.full(elevation.shape, np.nan, dtype=np.float64)
    for i, j in reversed(order):
        if streams[i, j] or down_i[i, j] < 0:
            stream_z[i, j] = elevation[i, j]
        else:
            stream_z[i, j] = stream_z[down_i[i, j], down_j[i, j]]
    hand = np.full(elevation.shape, np.nan, dtype=np.float32)
    ok = valid & np.isfinite(stream_z)
    hand[ok] = np.maximum(elevation[ok] - stream_z[ok], 0.0).astype(np.float32)
    return hand


def _on_edge(valid: np.ndarray, i: int, j: int) -> bool:
    height, width = valid.shape
    if i == 0 or j == 0 or i == height - 1 or j == width - 1:
        return True
    for di, dj in _DIRS:
        if not valid[i + di, j + dj]:
            return True
    return False


def _touches_lower(dem: np.ndarray, valid: np.ndarray, i: int, j: int) -> bool:
    height, width = dem.shape
    here = dem[i, j]
    for di, dj in _DIRS:
        ni = i + di
        nj = j + dj
        if ni < 0 or nj < 0 or ni >= height or nj >= width:
            continue
        if valid[ni, nj] and dem[ni, nj] < here:
            return True
    return False


def _no_stream_message(acc: np.ndarray, accum_cells: float) -> str:
    finite = acc[np.isfinite(acc)]
    peak = float(finite.max()) if finite.size else 0.0
    return (
        f"No cell reaches the accumulation threshold of {accum_cells:.0f} pixels "
        f"(the largest upstream count in this window is {peak:.0f}). "
        "Lower the drainage-area or pixel accumulation threshold."
    )


def summary_from_curve(curve: dict) -> dict:
    dataset_id = curve["dataset_id"]
    return {
        "dataset_id": dataset_id,
        "source_kind": curve["source_kind"],
        "source_name": curve.get("source_name"),
        "a_basin_m2": curve["a_basin_m2"],
        "bbox": curve["bbox"],
        "stream_threshold_km2": curve.get("stream_threshold_km2"),
        "accum_threshold_cells": curve.get("accum_threshold_cells"),
        "width": curve["width"],
        "height": curve["height"],
        "dx_m": curve["dx_m"],
        "dy_m": curve["dy_m"],
        "hand_engine": curve.get("hand_engine"),
        "scene": curve["scene"],
        "hand_url": f"/api/datasets/{dataset_id}/hand",
        "hypsometric_url": f"/api/datasets/{dataset_id}/hypsometric",
    }


def read_curve(dataset_id: str) -> dict:
    path = dataset_dir(dataset_id) / "hypsometric.json"
    if not path.is_file():
        raise FileNotFoundError(dataset_id)
    return json.loads(path.read_text(encoding="utf-8"))


def list_curves() -> list[dict]:
    root = DATA_DIR
    if not root.exists():
        return []
    found = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir() or entry.name.startswith(".") or entry.name.startswith("_"):
            continue
        curve_path = entry / "hypsometric.json"
        if curve_path.is_file():
            found.append(json.loads(curve_path.read_text(encoding="utf-8")))
    return found
