# HAND Flood Extent Modeler

An interactive geospatial sandbox for flood extent and inundation depth. It conditions terrain as Height Above Nearest Drainage (HAND), turns a rainfall depth into runoff with the Soil Conservation Service curve-number method, and fills that volume on a hypsometric stage–storage curve. Derivations are in [docs/methods.md](docs/methods.md). The papers those calculations cite are listed under [References](#references).

The map runs in the browser. The API only prepares a HAND raster and a stage–storage table, once per dataset.

---

## Run locally

You need two processes: the API on port **8000** and the Vite app on port **5173**. Open the map at [http://localhost:5173](http://localhost:5173). The dev server proxies `/api` to the API, so rainfall and curve-number changes stay in the browser.

### Prerequisites

- Python 3.11 or newer (3.13 works)
- Node.js 18 or newer, with npm

### 1. Install once

From the repository root. A virtualenv at the root (`.venv`) or inside `backend/` both work.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -U pip
python -m pip install -r backend/requirements.txt

cd frontend
npm install
```

`rasterio` and `pyproj` install from binary wheels on macOS, so a separate GDAL build is not required.

### 2. Start the API

The Python package is `backend/app`. Uvicorn has to run with `backend/` as the working directory. From the repository root that looks like `ModuleNotFoundError: No module named 'app'`.

In one terminal, from the repository root:

```bash
chmod +x init.sh   # once, so ./init.sh is executable
./init.sh
```

The script calls `.venv/bin/python` at the repository root, or `backend/.venv/bin/python` if that is where you created the environment. It then starts:

```bash
cd backend
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Leave that terminal open. A ready API prints `Uvicorn running on http://127.0.0.1:8000`. [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs) is the OpenAPI page, not the map.

### 3. Start the map

In a second terminal, from the repository root:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and click **Load sample**. The built-in scene is a clipped DEM of San Miguel, Bulacan.

Rainfall, curve number, and antecedent moisture update the depth layer in the browser. They do not call the API again. Uploading a GeoTIFF does: the API writes `backend/data/{dataset_id}/hand_cog.tif` and `hypsometric.json`.

### If the page has no flood layer

- The API terminal must still be running. The UI talks to it only when a dataset is loaded.
- Use port **5173**. Port 8000 serves the API.
- Confirm the API with `curl -s http://127.0.0.1:8000/docs | head`.
- Optional overrides live in [`.env.example`](.env.example). Copy it to `.env` only to change `DATA_DIR` or `VITE_API_BASE`. The app has no API keys.

---

## Containerized deployment

From the repository root, with Docker Compose v2:

```bash
docker compose build
docker compose up
```

Open [http://localhost:8080](http://localhost:8080) and click **Load sample**. The API is published on [http://127.0.0.1:8010](http://127.0.0.1:8010) so it does not collide with other stacks already bound to host port 8000. Stop with `docker compose down`. Datasets persist in the `hand_data` volume. `docker compose down -v` deletes that volume. Details are in [DOCKER.md](DOCKER.md).

---

## What the two pipelines do

Terrain preprocessing runs once on the server. Hydrology and coloring run in the browser on every slider change.

### Ingestion (server)

For an uploaded GeoTIFF, either a raw digital elevation model or an existing HAND raster:

1. Pit filling
2. Depression filling (priority-flood)
3. Flat resolution
4. D8 flow direction
5. D8 flow accumulation
6. Stream extraction where accumulation meets the drainage threshold
7. `HAND = z − z_stream`

`pysheds` 0.5 runs those steps. NumPy 2 removed `numpy.in1d`, which that release still calls, so startup aliases it to `numpy.isin`. If `pysheds` cannot be imported, the same seven steps run in NumPy. An uploaded HAND raster is used as given. Negatives are clipped to zero, and the stream threshold is ignored.

Pixel area for volumes comes from the UTM zone of the raster centroid. The stage–storage table is integrated from `0.00 m` to `15.00 m` at `0.05 m`. The map receives the same HAND values as a single-band Float32 Cloud Optimized GeoTIFF in EPSG:3857 (`hand_cog.tif`), nearest-neighbour warped so cell values are not averaged.

The processing window is at most `2048 × 2048` cells, so the browser can hold the grid. Smaller uploads run in full. Larger uploads take a window you drag on the map or type as coordinates. Accumulation and HAND are computed from cells inside that window only. The drainage threshold (default `1 km²`, or a cell count) decides where streams start. It does not drop cells from the basin area. A threshold larger than the window is rejected.

### Solver (browser)

On dataset load the client fetches `hypsometric.json` and `hand_cog.tif`. It computes direct runoff from rainfall depth `P` and curve number `CN`, then binary-searches the stage–storage curve for the equilibrium stage `h`. Cells with `0 ≤ HAND ≤ h` are flooded at depth `d = h − HAND`.

```text
S = (25400 / CN) − 254                         retention, mm

Q = (P − 0.2S)² / (P + 0.8S)    if P > 0.2S    runoff depth, mm
Q = 0                           if P ≤ 0.2S

V = (Q / 1000) × A_basin                       inflow volume, m³

d = h − HAND                    if 0 ≤ HAND ≤ h
```

The curve number is one number for the whole window (the lumped-watershed assumption in TR-55). Cover presets are hydrologic soil group B entries from that report. Antecedent moisture uses the Chow et al. (1988) fits to the National Engineering Handbook table. Initial abstraction stays at `0.2S`.

A volume that exceeds the `15.0 m` row clamps there, and the panel says the stage is capped.

---

## Scope

This sandbox produces inundation extent and water depth in metres. It does not estimate rice damage or economic loss. Araza and Alosnos (2026) map flood and drought loss to Philippine rice from depth, phenology, and damage curves. The depth field above is the kind of input that calculation consumes. This app does not ingest a rice mask, a growth stage, a damage curve, or a cost table.

The built-in sample is the San Miguel, Bulacan clip, used in full. Storage is integrated on native UTM cell area. The overlay is the same HAND values warped to Web Mercator for display. Uploads stay on local disk and are capped at 250 MB.

---

## References

Full derivations and the modeling assumptions are in [docs/methods.md](docs/methods.md). Citations below follow APA 7th edition, in the same order as that note.

Araza, A. B., & Alosnos, E. (2026). Advancing Earth Observation-based methods for rapid mapping and estimation of flood and drought impacts on rice production in the Philippines. *International Journal of Disaster Risk Reduction, 133*, Article 105979. https://doi.org/10.1016/j.ijdrr.2025.105979

Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models. *Computers & Geosciences, 62*, 117–127. https://doi.org/10.1016/j.cageo.2013.04.024

Bartos, M. (2025). *pysheds* (Version 0.5) [Computer software]. https://github.com/mdbartos/pysheds

Battersby, S. E., Finn, M. P., Usery, E. L., & Yamamoto, K. H. (2014). Implications of Web Mercator and its use in online mapping. *Cartographica, 49*(2), 85–101. https://doi.org/10.3138/carto.49.2.2313

Chow, V. T., Maidment, D. R., & Mays, L. W. (1988). *Applied hydrology*. McGraw-Hill.

Cloud Optimized GeoTIFF contributors. (n.d.). *Cloud Optimized GeoTIFF specification*. https://github.com/cogeotiff/cog-spec

Garbrecht, J., & Martz, L. W. (1997). The assignment of drainage direction over flat surfaces in raster digital elevation models. *Journal of Hydrology, 193*(1–4), 204–213. https://doi.org/10.1016/S0022-1694(96)03138-1

Garousi-Nejad, I., Tarboton, D. G., Aboutalebi, M., & Torres-Rua, A. F. (2019). Terrain analysis enhancements to the Height Above Nearest Drainage flood inundation mapping method. *Water Resources Research, 55*(10), 7983–8009. https://doi.org/10.1029/2019WR024837

Hawkins, R. H., Ward, T. J., Woodward, D. E., & Van Mullem, J. A. (2009). *Curve number hydrology: State of the practice*. American Society of Civil Engineers. https://doi.org/10.1061/9780784410042

Jenson, S. K., & Domingue, J. O. (1988). Extracting topographic structure from digital elevation data for geographic information system analysis. *Photogrammetric Engineering and Remote Sensing, 54*(11), 1593–1600.

Nobre, A. D., Cuartas, L. A., Hodnett, M., Rennó, C. D., Rodrigues, G., Silveira, A., Waterloo, M., & Saleska, S. (2011). Height above the nearest drainage – A hydrologically relevant new terrain model. *Journal of Hydrology, 404*(1–2), 13–29. https://doi.org/10.1016/j.jhydrol.2011.03.051

Nobre, A. D., Cuartas, L. A., Momo, M. R., Severo, D. L., Pinheiro, A., & Nobre, C. A. (2016). HAND contour: A new proxy predictor of inundation extent. *Hydrological Processes, 30*(2), 320–333. https://doi.org/10.1002/hyp.10581

O’Callaghan, J. F., & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. *Computer Vision, Graphics, and Image Processing, 28*(3), 323–344. https://doi.org/10.1016/S0734-189X(84)80011-0

Patel, K., Rajib, A., Biswas, N. K., Liu, Z., & Lofton, E. N. (2026). The HAND of flood mapping: Multi-dimensional evaluation across data-rich and data-poor basins using existing maps, ground observations, and remote sensing data. *Environmental Research Communications, 8*(5), Article 051008. https://doi.org/10.1088/2515-7620/ae6236

Rennó, C. D., Nobre, A. D., Cuartas, L. A., Soares, J. V., Hodnett, M. G., Tomasella, J., & Waterloo, M. J. (2008). HAND, a new terrain descriptor using SRTM-DEM: Mapping terra-firme rainforest environments in Amazonia. *Remote Sensing of Environment, 112*(9), 3469–3481. https://doi.org/10.1016/j.rse.2008.03.018

Snyder, J. P. (1987). *Map projections—A working manual* (Professional Paper No. 1395). U.S. Geological Survey. https://doi.org/10.3133/pp1395

U.S. Department of Agriculture, Natural Resources Conservation Service. (2004). Estimation of direct runoff from storm rainfall. In *National engineering handbook* (Part 630, Chapter 10).

U.S. Department of Agriculture, Soil Conservation Service. (1972). *National engineering handbook* (Section 4, Hydrology).

U.S. Department of Agriculture, Soil Conservation Service. (1986). *Urban hydrology for small watersheds* (Technical Release No. 55, 2nd ed.).

Woodward, D. E., Hawkins, R. H., Jiang, R., Hjelmfelt, A. T., Jr., Van Mullem, J. A., & Quan, Q. D. (2003). Runoff curve number method: Examination of the initial abstraction ratio. In P. Bizier & P. DeBarry (Eds.), *World Water & Environmental Resources Congress 2003*. American Society of Civil Engineers. https://doi.org/10.1061/40685(2003)308

Zheng, X., Tarboton, D. G., Maidment, D. R., Liu, Y. Y., & Passalacqua, P. (2018). River channel geometry and rating curve estimation using height above the nearest drainage. *Journal of the American Water Resources Association, 54*(4), 785–806. https://doi.org/10.1111/1752-1688.12661

### What each citation supports

| Topic | Sources |
| --- | --- |
| HAND definition and the depth proxy `d = h − HAND` | Nobre et al. (2011); Rennó et al. (2008); Nobre et al. (2016); Zheng et al. (2018) |
| Reach-wise stages, rating curves, and what a single stage leaves out | Garousi-Nejad et al. (2019); Zheng et al. (2018) |
| How stream density changes a HAND flood map | Patel et al. (2026) |
| Pit filling, depression filling, D8 flow, accumulation | Jenson and Domingue (1988); O'Callaghan and Mark (1984); Barnes et al. (2014) |
| Flats: this app imposes a 1 mm gradient; Garbrecht and Martz remains the reference two-phase method | Garbrecht and Martz (1997); Bartos (2025) |
| Curve number, `Ia = 0.2S`, and TR-55 cover presets | USDA, SCS (1972); USDA, NRCS (2004); USDA, SCS (1986); Hawkins et al. (2009) |
| Why `Ia = 0.05S` is not substituted into the published curve numbers | Woodward et al. (2003); Hawkins et al. (2009) |
| Dry and wet antecedent-moisture conversions | Chow et al. (1988) |
| UTM cell area versus Web Mercator display | Snyder (1987); Battersby et al. (2014) |
| Cloud Optimized GeoTIFF served to the map | Cloud Optimized GeoTIFF contributors (n.d.) |
| Methodology and Basis for HAND Concept | Araza and Alosnos (2026) |
