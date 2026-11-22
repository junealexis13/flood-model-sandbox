# HAND Flood Extent

A small geospatial sandbox. You set rainfall and a curve number. The map shades every cell whose height above the nearest stream is at or below the resulting stage, and colors that cell by depth.

Two pipelines stay separate so the sliders never wait on the server.

**Ingestion, once per GeoTIFF.** The API accepts a raw DEM or a HAND raster. A raw DEM is conditioned the same way as the reference notebook: fill pits, fill depressions, resolve flats, D8 flow direction, D8 accumulation, streams where accumulation is at least the drainage threshold, then `HAND = elevation − elevation of the first stream downstream`. pysheds runs those steps. NumPy 2 removed `numpy.in1d`, which pysheds 0.5 still calls, so the app aliases it to `numpy.isin` before import. If pysheds cannot be imported, the same seven steps run in NumPy. The raster centroid’s UTM zone fixes the ground size of a pixel, and a stage–storage curve is stored from 0 m to 15 m at 0.05 m. The served raster is a float32 Cloud Optimized GeoTIFF in EPSG:3857.

**Runtime, in the browser.** The page loads `hypsometric.json` and the COG. Excess rain is the SCS equation

```text
S = 25400/CN − 254
Q = (P − 0.2S)² / (P + 0.8S)   when P > 0.2S, else 0
V = Q/1000 × basin area
```

A binary search plus linear interpolation turns `V` into a stage. Depth at a cell is `stage − HAND` where `0 ≤ HAND ≤ stage`.

Scenes are at most **512×512** pixels. A smaller upload is computed in full. A larger one opens a window you drag or type; every pixel inside that window is used. The accumulation threshold only decides which cells are streams. It does not drop pixels from the scene. The default is 1 km², converted to a cell count with the UTM pixel area, and you can type the cell count directly.

## Run it locally

Backend (Python 3.11+):

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API is proxied from `/api`. Click **Load sample** if the valley is not already on the map.

Files for each dataset are written to `backend/data/{dataset_id}/` as `hand_cog.tif` and `hypsometric.json`.

Optional settings are listed in `.env.example`. None are required, and that file contains no secrets. Copy it to `.env` only if you want to override `DATA_DIR` or `VITE_API_BASE`.

## Docker

From the repository root:

```bash
docker compose build
docker compose up
```

Open [http://localhost:8080](http://localhost:8080) and click **Load sample**. Stop with `docker compose down`. Datasets stay in the `hand_data` volume, mounted at `/app/data` in the API container. `docker compose down -v` deletes that volume. The same steps are in [DOCKER.md](DOCKER.md).

## Methods

The terrain, runoff, and stage calculations are written up in [docs/methods.md](docs/methods.md), with the sources in APA 7th edition. The note covers height above the nearest drainage, the curve-number equation and the antecedent-moisture conversions, the stage–storage integral, why areas are computed in UTM rather than on the map, and the 512-pixel scene limit. It also places the sandbox against Araza and Alosnos’s Philippine rice loss-and-damage study: this app produces a depth map, and it does not estimate rice losses.

## Limits

- The sample is a synthetic valley placed near Bay, Laguna so the satellite basemap has a frame. It is not a survey of that landscape.
- The stage curve stops at 15 m. A larger inflow stays at 15 m and the panel says so.
- Volumes use the native pixel’s ground area. The map raster is the same HAND, nearest-neighbor warped to Web Mercator.
- If the accumulation threshold is larger than the window, processing stops and asks you to lower it. A button in the upload dialog can set it to 2% of the window.
- Uploads are stored on the local disk only, up to 250 MB.
