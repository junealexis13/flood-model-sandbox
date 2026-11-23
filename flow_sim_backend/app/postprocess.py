"""Post-process ANUGA .sww NetCDF output into centered Three.js binary buffers and metadata."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import netCDF4
import numpy as np

from app.storage import write_json_atomic

WET_THRESHOLD_M = 0.005


def postprocess_sww(
    sww_path: Path,
    job_dir: Path,
    *,
    job_id: str,
    utm_epsg: int | None,
    params: dict[str, Any],
) -> dict[str, Any]:
    """Convert simulation.sww into mesh.bin, frames.bin, and result.json."""
    if not sww_path.is_file():
        raise FileNotFoundError(f"ANUGA output file not found: {sww_path}")

    with netCDF4.Dataset(str(sww_path), mode="r") as nc:
        xll = float(getattr(nc, "xllcorner", 0.0))
        yll = float(getattr(nc, "yllcorner", 0.0))

        x_abs = np.asarray(nc.variables["x"][:], dtype=np.float64) + xll
        y_abs = np.asarray(nc.variables["y"][:], dtype=np.float64) + yll

        elev_raw = np.asarray(nc.variables["elevation"][:], dtype=np.float32)
        elevation = elev_raw[0] if elev_raw.ndim == 2 else elev_raw
        elevation = np.nan_to_num(elevation, nan=0.0, posinf=0.0, neginf=0.0).astype("<f4")

        volumes = np.asarray(nc.variables["volumes"][:], dtype=np.int64)
        if volumes.ndim != 2 or volumes.shape[1] != 3:
            raise ValueError(f"Unexpected volumes shape in .sww: {volumes.shape}")

        times = np.asarray(nc.variables["time"][:], dtype=np.float64)
        stage = np.asarray(nc.variables["stage"][:], dtype=np.float32)
        xmomentum = np.asarray(nc.variables["xmomentum"][:], dtype=np.float32)
        ymomentum = np.asarray(nc.variables["ymomentum"][:], dtype=np.float32)

    # Center coordinates around local origin (0, 0) in meters to avoid Float32 WebGL precision jitter.
    x_mean = float(np.mean(x_abs))
    y_mean = float(np.mean(y_abs))
    x_local = (x_abs - x_mean).astype("<f4")
    y_local = (y_abs - y_mean).astype("<f4")

    # Enforce CCW 2D winding so Three.js (x, elevation, -y) triangle normals point upward (+Y).
    i0 = volumes[:, 0]
    i1 = volumes[:, 1]
    i2 = volumes[:, 2]
    dx1 = x_abs[i1] - x_abs[i0]
    dy1 = y_abs[i1] - y_abs[i0]
    dx2 = x_abs[i2] - x_abs[i0]
    dy2 = y_abs[i2] - y_abs[i0]
    signed_area_2 = dx1 * dy2 - dy1 * dx2
    flipped = signed_area_2 < 0
    if np.any(flipped):
        volumes = volumes.copy()
        volumes[flipped, 1], volumes[flipped, 2] = volumes[flipped, 2], volumes[flipped, 1]
        i1 = volumes[:, 1]
        i2 = volumes[:, 2]

    tri_areas = (0.5 * np.abs(signed_area_2)).astype(np.float64)
    total_area_m2 = float(np.sum(tri_areas))
    indices = np.ascontiguousarray(volumes.reshape(-1), dtype="<u4")

    stage = np.nan_to_num(stage, nan=0.0, posinf=0.0, neginf=0.0).astype("<f4")
    xmomentum = np.nan_to_num(xmomentum, nan=0.0, posinf=0.0, neginf=0.0).astype("<f4")
    ymomentum = np.nan_to_num(ymomentum, nan=0.0, posinf=0.0, neginf=0.0).astype("<f4")

    depth = np.maximum(0.0, stage - elevation[None, :]).astype("<f4")
    momentum_mag = np.hypot(xmomentum, ymomentum)
    speed = (momentum_mag / np.maximum(depth, np.float32(1e-4))).astype("<f4")
    speed = np.where(depth >= np.float32(WET_THRESHOLD_M), speed, np.float32(0.0)).astype("<f4")
    speed = np.nan_to_num(speed, nan=0.0, posinf=0.0, neginf=0.0).astype("<f4")

    frame_count = int(stage.shape[0])
    vertex_count = int(x_local.shape[0])
    triangle_count = int(volumes.shape[0])

    frame_stats: list[dict[str, float]] = []
    max_depth_global = 0.0
    max_vel_global = 0.0
    max_inundated_global = 0.0

    for t_idx in range(frame_count):
        d_frame = depth[t_idx]
        v_frame = speed[t_idx]
        tri_mean_depth = (d_frame[i0] + d_frame[i1] + d_frame[i2]) / 3.0
        inundated_area = float(np.sum(tri_areas[tri_mean_depth >= WET_THRESHOLD_M]))
        peak_depth = float(np.max(d_frame)) if d_frame.size else 0.0
        max_vel = float(np.max(v_frame)) if v_frame.size else 0.0

        max_depth_global = max(max_depth_global, peak_depth)
        max_vel_global = max(max_vel_global, max_vel)
        max_inundated_global = max(max_inundated_global, inundated_area)

        frame_stats.append(
            {
                "time_sec": round(float(times[t_idx]), 3),
                "peak_depth_m": round(peak_depth, 4),
                "max_velocity_m_s": round(max_vel, 4),
                "inundated_area_m2": round(inundated_area, 2),
            }
        )

    mesh_path = job_dir / "mesh.bin"
    frames_path = job_dir / "frames.bin"

    mesh_layout, mesh_bytes = _write_binary_bundle(
        mesh_path,
        [
            ("x_local", np.ascontiguousarray(x_local, dtype="<f4"), "float32"),
            ("y_local", np.ascontiguousarray(y_local, dtype="<f4"), "float32"),
            ("elevation", np.ascontiguousarray(elevation, dtype="<f4"), "float32"),
            ("indices", indices, "uint32"),
        ],
    )

    frames_layout, frames_bytes = _write_binary_bundle(
        frames_path,
        [
            ("stage", np.ascontiguousarray(stage.reshape(-1), dtype="<f4"), "float32"),
            ("depth", np.ascontiguousarray(depth.reshape(-1), dtype="<f4"), "float32"),
            ("speed", np.ascontiguousarray(speed.reshape(-1), dtype="<f4"), "float32"),
        ],
    )

    metadata: dict[str, Any] = {
        "job_id": job_id,
        "vertex_count": vertex_count,
        "triangle_count": triangle_count,
        "frame_count": frame_count,
        "times_sec": [round(float(t), 3) for t in times.tolist()],
        "utm_epsg": utm_epsg,
        "utm_origin": [round(x_mean, 3), round(y_mean, 3)],
        "bounds_local": {
            "min_x": float(np.min(x_local)),
            "max_x": float(np.max(x_local)),
            "min_y": float(np.min(y_local)),
            "max_y": float(np.max(y_local)),
            "min_z": float(np.min(elevation)),
            "max_z": float(np.max(elevation)),
        },
        "global_stats": {
            "max_depth_m": round(max_depth_global, 4),
            "max_velocity_m_s": round(max_vel_global, 4),
            "max_inundated_area_m2": round(max_inundated_global, 2),
            "total_area_m2": round(total_area_m2, 2),
        },
        "frame_stats": frame_stats,
        "params": params,
        "buffers": {
            "mesh_url": f"/api/flow-sim/jobs/{job_id}/result/mesh.bin",
            "frames_url": f"/api/flow-sim/jobs/{job_id}/result/frames.bin",
            "mesh_bytes": mesh_bytes,
            "frames_bytes": frames_bytes,
            "mesh_layout": mesh_layout,
            "frames_layout": frames_layout,
        },
    }

    write_json_atomic(job_dir / "result.json", metadata)
    return metadata


def _write_binary_bundle(
    dest: Path,
    arrays: list[tuple[str, np.ndarray, str]],
) -> tuple[dict[str, dict[str, Any]], int]:
    layout: dict[str, dict[str, Any]] = {}
    offset = 0
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with tmp.open("wb") as handle:
        for name, arr, dtype_label in arrays:
            raw = arr.tobytes()
            layout[name] = {
                "offset_bytes": offset,
                "length": int(arr.size),
                "dtype": dtype_label,
            }
            handle.write(raw)
            offset += len(raw)
    tmp.replace(dest)
    return layout, offset
