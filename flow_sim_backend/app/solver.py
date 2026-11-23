"""Isolated ANUGA 2D shallow-water solver worker invoked as `python -m app.solver <job_dir>`."""

from __future__ import annotations

import json
import logging
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

from app.dem_prep import prepare_dem_for_anuga
from app.postprocess import postprocess_sww
from app.storage import write_status

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("flow_sim.solver")


def run_job(directory: Path) -> None:
    config_path = directory / "config.json"
    if not config_path.is_file():
        raise FileNotFoundError(f"Missing job config: {config_path}")

    config: dict[str, Any] = json.loads(config_path.read_text(encoding="utf-8"))
    job_id = str(config["job_id"])
    dem_path = Path(config["dem_path"])
    dem_name = str(config.get("dem_name") or dem_path.name)
    rain_mm_hr = float(config["rain_mm_hr"])
    duration_sec = float(config["duration_sec"])
    yieldstep_sec = float(config["yieldstep_sec"])
    mannings_n = float(config["mannings_n"])
    requested_tri_area = config.get("max_triangle_area")
    boundary_mode = str(config["boundary_mode"])

    work_dir = directory / "work"
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        write_status(
            directory,
            job_id=job_id,
            state="meshing",
            progress=4.0,
            sim_time_sec=0.0,
            duration_sec=duration_sec,
            message="Inspecting CRS, reprojecting DEM to UTM, and preparing ANUGA elevation points…",
            dem_name=dem_name,
        )

        prepared = prepare_dem_for_anuga(
            dem_path,
            work_dir,
            requested_max_triangle_area=(
                float(requested_tri_area) if requested_tri_area is not None else None
            ),
        )

        write_status(
            directory,
            job_id=job_id,
            state="meshing",
            progress=14.0,
            sim_time_sec=0.0,
            duration_sec=duration_sec,
            message=(
                f"Building unstructured triangular mesh "
                f"(max triangle area {prepared.max_triangle_area_m2:.0f} m²)…"
            ),
            dem_name=dem_name,
        )

        import anuga

        exterior_edges = list(range(len(prepared.bounding_polygon)))
        mesh_path = work_dir / "domain.msh"
        domain = anuga.create_domain_from_regions(
            prepared.bounding_polygon,
            boundary_tags={"exterior": exterior_edges},
            maximum_triangle_area=prepared.max_triangle_area_m2,
            mesh_filename=str(mesh_path),
            use_cache=False,
            verbose=False,
        )

        domain.set_datadir(str(work_dir))
        domain.set_name("simulation")
        domain.set_store_vertices_uniquely(False)

        domain.set_quantity(
            "elevation",
            filename=str(prepared.pts_path),
            use_cache=False,
            verbose=False,
        )
        _sanitize_elevation(domain, prepared.mean_elevation_m)

        domain.set_quantity("friction", mannings_n)
        domain.set_quantity("stage", expression="elevation")

        rain_rate_m_s = (rain_mm_hr / 1000.0) / 3600.0
        _attach_rainfall(anuga, domain, rain_rate_m_s)

        if boundary_mode == "closed":
            boundary = anuga.Reflective_boundary(domain)
        else:
            outflow_stage = prepared.min_elevation_m - 0.5
            boundary = anuga.Dirichlet_boundary([outflow_stage, 0.0, 0.0])
        domain.set_boundary({"exterior": boundary})

        tri_count = int(domain.number_of_triangles)
        write_status(
            directory,
            job_id=job_id,
            state="running",
            progress=20.0,
            sim_time_sec=0.0,
            duration_sec=duration_sec,
            message=f"Solving 2D shallow water equations across {tri_count:,} triangles…",
            dem_name=dem_name,
        )

        for t in domain.evolve(yieldstep=yieldstep_sec, finaltime=duration_sec):
            t_val = float(t)
            frac = min(1.0, max(0.0, t_val / max(duration_sec, 1e-6)))
            progress = 20.0 + 70.0 * frac
            write_status(
                directory,
                job_id=job_id,
                state="running",
                progress=progress,
                sim_time_sec=t_val,
                duration_sec=duration_sec,
                message=f"Simulating flood wave (t = {t_val:.0f}s / {duration_sec:.0f}s)…",
                dem_name=dem_name,
            )

        write_status(
            directory,
            job_id=job_id,
            state="running",
            progress=92.0,
            sim_time_sec=duration_sec,
            duration_sec=duration_sec,
            message="Post-processing .sww NetCDF frames and packing binary buffers for Three.js…",
            dem_name=dem_name,
        )

        sww_path = work_dir / "simulation.sww"
        postprocess_sww(
            sww_path,
            directory,
            job_id=job_id,
            utm_epsg=prepared.utm_epsg,
            params={
                "dem_name": dem_name,
                "rain_mm_hr": rain_mm_hr,
                "duration_sec": duration_sec,
                "yieldstep_sec": yieldstep_sec,
                "mannings_n": mannings_n,
                "max_triangle_area": round(prepared.max_triangle_area_m2, 2),
                "boundary_mode": boundary_mode,
            },
        )

        # Clean up large temporary terrain conversion files while preserving packed outputs.
        for temp_name in ("terrain.asc", "terrain.dem", "terrain.pts", "terrain.prj", "domain.msh"):
            (work_dir / temp_name).unlink(missing_ok=True)

        write_status(
            directory,
            job_id=job_id,
            state="completed",
            progress=100.0,
            sim_time_sec=duration_sec,
            duration_sec=duration_sec,
            message="Simulation complete.",
            dem_name=dem_name,
        )
    except Exception as exc:
        logger.exception("Simulation job %s failed", job_id)
        write_status(
            directory,
            job_id=job_id,
            state="failed",
            progress=100.0,
            sim_time_sec=0.0,
            duration_sec=duration_sec,
            message="Simulation failed.",
            error=str(exc) or traceback.format_exc(limit=3),
            dem_name=dem_name,
        )
        raise


def _sanitize_elevation(domain: Any, fallback_m: float) -> None:
    qty = domain.quantities["elevation"]
    for attr in ("vertex_values", "centroid_values", "edge_values"):
        arr = getattr(qty, attr, None)
        if arr is None:
            continue
        bad = ~np.isfinite(arr)
        if np.any(bad):
            logger.warning("Replaced %d non-finite values in elevation.%s", int(bad.sum()), attr)
            arr[bad] = fallback_m


def _attach_rainfall(anuga_mod: Any, domain: Any, rate_m_s: float) -> Any:
    if hasattr(anuga_mod, "Rainfall"):
        return anuga_mod.Rainfall(domain, rate=rate_m_s)
    if hasattr(anuga_mod, "Rate_operator"):
        return anuga_mod.Rate_operator(domain, rate=rate_m_s)
    from anuga.operators.rate_operators import Rate_operator

    return Rate_operator(domain, rate=rate_m_s)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: python -m app.solver <job_dir>", file=sys.stderr)
        return 2
    run_job(Path(argv[1]).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
