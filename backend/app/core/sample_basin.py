"""Built-in sample: the clipped San Miguel, Bulacan DEM.

The raster is sample_rasters/san_miguel_clipped.tif, about 5 m cells in UTM
zone 51N. The whole clip fits in the 2048-pixel scene limit.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

from app.core.hand_generator import process_raster, read_curve
from app.core.storage import DATA_DIR, dataset_dir

SAMPLE_ID = "sample"
SAMPLE_NAME = "San Miguel, Bulacan"


def ensure_sample() -> dict:
    dest = dataset_dir(SAMPLE_ID)
    curve_path = dest / "hypsometric.json"
    cog = dest / "hand_cog.tif"
    if curve_path.is_file() and cog.is_file():
        curve = read_curve(SAMPLE_ID)
        if curve.get("source_name") == SAMPLE_NAME:
            return curve
    return build_sample(dest)


def dem_path() -> Path:
    override = os.environ.get("SAMPLE_DEM")
    if override:
        path = Path(override)
        if not path.is_file():
            raise FileNotFoundError(f"SAMPLE_DEM is not a file: {path}")
        return path
    candidates = [
        Path("/opt/sample-dem/san_miguel_clipped.tif"),
        Path(__file__).resolve().parents[3] / "sample_rasters" / "san_miguel_clipped.tif",
    ]
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError(
        "The San Miguel DEM is missing. Expected sample_rasters/san_miguel_clipped.tif."
    )


def build_sample(dest: Path) -> dict:
    source = dem_path()
    work = DATA_DIR / "_work" / "sample-build"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True)
    dem = work / "source_dem.tif"
    try:
        shutil.copyfile(source, dem)
        if dest.exists():
            shutil.rmtree(dest)
        payload = process_raster(
            dem,
            dest,
            dataset_id=SAMPLE_ID,
            source_kind="dem",
            source_name=SAMPLE_NAME,
            window=None,
            stream_threshold_km2=1.0,
            accum_threshold_cells=None,
        )
        shutil.copyfile(dem, dest / "source_dem.tif")
        payload["source_kind"] = "sample"
        (dest / "hypsometric.json").write_text(json.dumps(payload), encoding="utf-8")
        return payload
    except Exception:
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    curve = build_sample(dataset_dir(SAMPLE_ID))
    print(
        "sample",
        curve["source_name"],
        curve["width"],
        curve["height"],
        "basin_km2",
        round(curve["a_basin_m2"] / 1e6, 3),
        "dx_m",
        round(curve["dx_m"], 2),
        "engine",
        curve["hand_engine"],
        "cells",
        round(curve["accum_threshold_cells"] or 0),
    )
