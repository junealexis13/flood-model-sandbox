"""Stage-area and stage-volume curve for a HAND surface.

Depth at a cell is max(stage − HAND, 0), the same inundation used by the
reference viewer. Volume is that depth integrated over the true ground
pixel area. Stages run from 0 m to 15 m at 0.05 m.
"""

from __future__ import annotations

import numpy as np

DH_M = 0.05
H_MAX_M = 15.0


def stage_levels() -> np.ndarray:
    count = int(round(H_MAX_M / DH_M))
    return np.arange(count + 1, dtype=np.float64) * DH_M


def build_hypsometric(
    hand: np.ndarray,
    valid: np.ndarray,
    dx_m: float,
    dy_m: float,
) -> dict[str, list[float] | float]:
    """Return stages (m), flooded areas (m²), and storage volumes (m³)."""
    if dx_m <= 0 or dy_m <= 0:
        raise ValueError("Pixel size must be positive.")
    values = np.asarray(hand, dtype=np.float64)
    mask = np.asarray(valid, dtype=bool) & np.isfinite(values) & (values >= 0)
    heights = np.sort(values[mask])
    pixel_area = float(dx_m) * float(dy_m)
    stages = stage_levels()
    if heights.size == 0:
        zeros = [0.0] * int(stages.size)
        return {
            "a_basin_m2": 0.0,
            "stages_m": [float(s) for s in stages],
            "areas_m2": zeros,
            "volumes_m3": zeros,
            "pixel_area_m2": pixel_area,
        }

    # Cells with HAND <= h are wet. Volume = Σ (h − HAND) ΔA.
    counts = np.searchsorted(heights, stages, side="right")
    cumulative = np.concatenate(([0.0], np.cumsum(heights)))
    volumes = (stages * counts - cumulative[counts]) * pixel_area
    areas = counts.astype(np.float64) * pixel_area
    return {
        "a_basin_m2": float(heights.size) * pixel_area,
        "stages_m": [round(float(s), 2) for s in stages],
        "areas_m2": [float(a) for a in areas],
        "volumes_m3": [float(v) for v in volumes],
        "pixel_area_m2": pixel_area,
    }
