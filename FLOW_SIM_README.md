# 3D Hydrodynamic Flood Flow Simulation (ANUGA + Three.js)

A standalone **2D Shallow Water Equations (SWE)** flood flow simulation tool integrated alongside the existing **HAND (Height Above Nearest Drainage)** tool inside the Flood Model Sandbox platform.

- **HAND Flood Extent** remains untouched for rapid static/stage-based inundation mapping.
- **3D Flow Simulation** runs full unsteady 2D hydrodynamic routing (momentum, overland wave propagation, Manning's roughness, open vs. closed boundaries) in an isolated **ANUGA** backend service and renders time-varying 3D terrain and water meshes in **Three.js**.

---

## Architecture

| Layer | Location | Port | Purpose |
| --- | --- | --- | --- |
| Unified Web UI | `frontend/` (`src/flowSim/`) | `5173` (dev) / `8080` (Docker) | Top-level switcher between **HAND** and **3D Flow Simulation** |
| HAND API (unchanged) | `backend/` | `8000` (dev) / `8010` (Docker) | Fast static HAND + hypsometric stage–storage endpoints (`/api/*`) |
| ANUGA Flow Sim API | `flow_sim_backend/` | `8001` (dev) / `8011` (Docker) | Unsteady 2D SWE job submission, polling, and binary mesh/frame streaming (`/api/flow-sim/*`) |

Both Nginx (`frontend/nginx.conf`) and Vite (`frontend/vite.config.ts`) proxy `/api/flow-sim/*` to the ANUGA service and `/api/*` to the HAND service under one origin.

---

## Run with Docker Compose (Recommended)

From the repository root:

```bash
docker compose build
docker compose up
```

Open **[http://localhost:8080](http://localhost:8080)** and use the top-center switcher to move between **HAND Flood Extent** and **3D Flow Simulation** (or jump directly to `http://localhost:8080/#flow-sim`).

- Flow Sim API health check: `http://127.0.0.1:8011/api/flow-sim/health`
- Flow Sim OpenAPI docs: `http://127.0.0.1:8011/docs`
- Simulation jobs persist in the `flow_sim_data` Docker volume.

---

## Run Locally with Conda / Mamba (Without Docker)

ANUGA relies on native C/Cython, GDAL, Triangle, and NetCDF libraries packaged on `conda-forge`.

### 1. Create the ANUGA environment

Using `mamba` or `micromamba` (or `conda`):

```bash
mamba env create -f flow_sim_backend/environment.yml
mamba activate anuga-flow-sim
```

### 2. Start all 3 services in one command

From the repository root:

```bash
./init.sh
```

This launches all 3 services in isolated environments (`.venv` for HAND on `:8000`, Conda `anuga-flow-sim` for ANUGA on `:8001`, and Vite on `:5173`) and stops all 3 cleanly on `Ctrl+C`.

You can also deploy or stop the 3-container Docker Compose stack from the same script:

```bash
./init.sh docker -d   # build and run in background on http://localhost:8080
./init.sh down        # stop containers
```

Open **[http://localhost:5173/#flow-sim](http://localhost:5173/#flow-sim)** (local) or **[http://localhost:8080/#flow-sim](http://localhost:8080/#flow-sim)** (Docker).

---

## API Reference (`/api/flow-sim`)

- `GET /api/flow-sim/health` — Service health check.
- `GET /api/flow-sim/samples` — Lists built-in sample DEMs from `sample_rasters/catalog.json`.
- `POST /api/flow-sim/jobs` (`multipart/form-data`) — Starts an asynchronous ANUGA simulation (`202 Accepted`):
  - `file` (`.tif`, `.tiff`, `.asc`) **or** `sample_id` (built-in sample DEM)
  - `rain_mm_hr` (`float`, default `60.0`) — Uniform direct rainfall intensity in mm/hr
  - `duration_sec` (`float`, default `1800.0`) — Total simulation duration in seconds
  - `yieldstep_sec` (`float`, default `60.0`) — Output frame interval in seconds
  - `mannings_n` (`float`, default `0.035`) — Manning's roughness coefficient
  - `max_triangle_area` (`float`, optional) — Mesh resolution in m² (auto-derived to ~5,500 triangles when omitted; capped at 50,000 triangles)
  - `boundary_mode` (`"open"` | `"closed"`, default `"open"`) — Free Dirichlet outflow vs. reflective closed basin
- `GET /api/flow-sim/jobs/{job_id}/status` — Returns `{ state, progress, sim_time_sec, duration_sec, message, error }` where `state` is `queued | meshing | running | completed | failed`.
- `GET /api/flow-sim/jobs/{job_id}/result` — Returns JSON metadata (UTM offset, local bounds, per-frame summary stats, and binary buffer layouts).
- `GET /api/flow-sim/jobs/{job_id}/result/mesh.bin` — Packed little-endian `Float32`/`Uint32` arrays (`x_local`, `y_local`, `elevation`, `indices`).
- `GET /api/flow-sim/jobs/{job_id}/result/frames.bin` — Packed little-endian `Float32` time-series arrays (`stage`, `depth`, `speed`).

---

## Technical Notes

- **Automatic UTM Reprojection**: Uploaded geographic DEMs (e.g. `EPSG:4326`) or non-metric rasters are automatically reprojected to the centroid's local UTM zone (`EPSG:326xx` / `327xx`) with square metric cells before generating ANUGA `.dem` and `.pts` files.
- **WebGL Float32 Precision Fix**: Post-processing subtracts `x.mean()` and `y.mean()` from UTM vertex coordinates so Three.js renders centered at `(0, 0, 0)` in local meters without camera jitter. The exact `[x_mean, y_mean]` offset (`utm_origin`) and `utm_epsg` are preserved in `result.json` so the interactive 3D raycast inspector displays true UTM Easting/Northing coordinates.
- **Dry-Cell Clipping**: Water surface fragments below `0.005 m` depth are discarded in the water shader so shorelines stay sharp without z-fighting on dry hillslopes.
- **Load Current DEM from HAND**: If you already opened a sample basin or uploaded a raw DEM in HAND during your session, click **Load Current DEM from HAND** in the Flow Sim sidebar to reuse that terrain immediately.
