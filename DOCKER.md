# Run HAND Flood Extent with Docker

No accounts, API keys, or secrets. The image does not bake in credentials.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose version` should print a version).
- Ports 8000 and 8080 free on your machine.

## Build

From the repository root:

```bash
docker compose build
```

## Run

```bash
docker compose up
```

Leave that terminal open. The API listens on port 8000 and the web UI on port 8080.

## Open the UI

In a browser, open [http://localhost:8080](http://localhost:8080).

## Load the sample

Click **Load sample**. The first start copies a synthetic valley into the data volume, so this works without uploading a GeoTIFF. Rainfall and curve number update the map in the browser. They do not call the API.

A raster larger than 512×512 asks you to draw a window. Smaller rasters are computed in full. Raw DEMs still use the stream accumulation threshold (default 1 km², also editable in cells).

## Stop

In the same directory:

```bash
docker compose down
```

That stops the containers and keeps the data volume.

## Where data is stored

Datasets live in the Docker volume named `hand_data`, mounted at `/app/data` inside the API container.

- Sample: `/app/data/sample/hand_cog.tif` and `/app/data/sample/hypsometric.json`
- Each upload: `/app/data/{dataset_id}/hand_cog.tif` and `/app/data/{dataset_id}/hypsometric.json`

On a checkout without Docker, those same files are under `backend/data/`.

Optional environment variables are in `.env.example` at the repository root. Docker Compose sets `DATA_DIR=/app/data` itself, so `docker compose up` does not need a `.env` file. Do not put tokens or passwords in that file; this app does not use any.

To delete the volume and the datasets in it:

```bash
docker compose down -v
```

The next `docker compose up` copies the sample back in.
