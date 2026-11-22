FROM python:3.11-slim-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /uvx /bin/

RUN apt-get update \
    && apt-get install -y --no-install-recommends gdal-bin libgdal-dev gcc g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV UV_SYSTEM_PYTHON=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    DATA_DIR=/app/data \
    PYTHONUNBUFFERED=1

COPY backend/requirements.txt /app/requirements.txt
RUN --mount=type=cache,target=/root/.cache/uv \
    uv pip install -r /app/requirements.txt

COPY backend/app /app/app
COPY sample_rasters/san_miguel_clipped.tif /opt/sample-dem/san_miguel_clipped.tif
COPY backend/data/sample /opt/sample-seed
COPY backend/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/app/entrypoint.sh"]
