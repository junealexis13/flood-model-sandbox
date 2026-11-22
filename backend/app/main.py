"""HAND flood extent API.

The server prepares a HAND raster and a stage-storage curve once per upload.
Stage, runoff, and the depth colors are computed in the browser.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.core.storage import ensure_data_dir

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="HAND Flood Extent", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api")


@app.on_event("startup")
def _startup() -> None:
    ensure_data_dir()
