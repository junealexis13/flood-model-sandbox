"""FastAPI application for the standalone 2D ANUGA hydrodynamic flow simulator."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import router
from app.storage import ensure_data_dir

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

app = FastAPI(title="ANUGA 2D Hydrodynamic Flow Simulation", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api/flow-sim")


@app.on_event("startup")
def _startup() -> None:
    ensure_data_dir()
