"""Synthetic valley used when the UI loads the sample dataset.

The surface is invented. It is only placed near Bay, Laguna so the satellite
basemap has a recognizable frame. It is not a survey of that landscape.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine

from app.core.hand_generator import process_raster, read_curve
from app.core.storage import DATA_DIR, dataset_dir

SAMPLE_ID = "sample"
_ROWS = 210
_COLS = 168
_PIXEL_M = 30.0


def ensure_sample() -> dict:
    dest = dataset_dir(SAMPLE_ID)
    curve = dest / "hypsometric.json"
    cog = dest / "hand_cog.tif"
    if curve.is_file() and cog.is_file():
        return read_curve(SAMPLE_ID)
    return build_sample(dest)


def build_sample(dest: Path) -> dict:
    work = DATA_DIR / "_work" / "sample-build"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    dem_path = work / "source_dem.tif"
    try:
        _write_synthetic_dem(dem_path)
        if dest.exists():
            shutil.rmtree(dest)
        payload = process_raster(
            dem_path,
            dest,
            dataset_id=SAMPLE_ID,
            source_kind="dem",
            source_name="Synthetic valley",
            window=None,
            stream_threshold_km2=1.0,
            accum_threshold_cells=None,
        )
        shutil.copyfile(dem_path, dest / "source_dem.tif")
        payload["source_kind"] = "sample"
        (dest / "hypsometric.json").write_text(json.dumps(payload), encoding="utf-8")
        return payload
    except Exception:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


def _write_synthetic_dem(path: Path) -> None:
    elevation = _valley(_ROWS, _COLS)
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32651", always_xy=True)
    east, north = to_utm.transform(121.25, 14.15)
    west = east - (_COLS / 2.0) * _PIXEL_M
    northing = north + (_ROWS / 2.0) * _PIXEL_M
    transform = Affine(_PIXEL_M, 0.0, west, 0.0, -_PIXEL_M, northing)
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=_ROWS,
        width=_COLS,
        count=1,
        dtype="float32",
        crs="EPSG:32651",
        transform=transform,
        nodata=-9999.0,
    ) as dst:
        dst.write(elevation, 1)


def _valley(rows: int, cols: int) -> np.ndarray:
    rows_i, cols_i = np.mgrid[0:rows, 0:cols]
    ys = rows_i.astype(np.float64)
    xs = cols_i.astype(np.float64)
    channel = (cols * 0.55) + 9.0 * np.sin(ys / 17.0) + 3.0 * np.sin(ys / 7.5)
    dist = np.abs(xs - channel)
    elev = 88.0 - ys * 0.13 + np.power(dist, 1.34) * 0.36

    join = int(rows * 0.7)
    start_row = int(rows * 0.4)
    start_col = 6.0
    end_row = float(join)
    end_col = float(channel[join, 0])
    span = float(np.hypot(end_row - start_row, end_col - start_col))
    vr = (end_row - start_row) / span
    vc = (end_col - start_col) / span
    along = np.clip((ys - start_row) * vr + (xs - start_col) * vc, 0.0, span)
    near_row = start_row + along * vr
    near_col = start_col + along * vc
    cross = np.hypot(ys - near_row, xs - near_col)
    mouth = 88.0 - end_row * 0.13
    tributary = mouth + (span - along) * 0.2 + np.power(cross, 1.34) * 0.48
    carve = along < (span - 1.0)
    elev = np.where(carve, np.minimum(elev, tributary), elev)
    return elev.astype(np.float32)


if __name__ == "__main__":
    curve = build_sample(dataset_dir(SAMPLE_ID))
    print(
        "sample",
        curve["width"],
        curve["height"],
        "basin_km2",
        round(curve["a_basin_m2"] / 1e6, 3),
        "engine",
        curve["hand_engine"],
        "cells",
        round(curve["accum_threshold_cells"] or 0),
    )
