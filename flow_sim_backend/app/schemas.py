"""Pydantic schemas for the ANUGA 2D hydrodynamic simulation API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

JobState = Literal["queued", "meshing", "running", "completed", "failed"]
BoundaryMode = Literal["open", "closed"]


class JobStatusResponse(BaseModel):
    job_id: str
    state: JobState
    progress: float = Field(ge=0.0, le=100.0)
    sim_time_sec: float = 0.0
    duration_sec: float = 0.0
    message: str = ""
    error: str | None = None
    dem_name: str | None = None
    updated_at: str


class BoundsLocal(BaseModel):
    min_x: float
    max_x: float
    min_y: float
    max_y: float
    min_z: float
    max_z: float


class FrameStat(BaseModel):
    time_sec: float
    peak_depth_m: float
    max_velocity_m_s: float
    inundated_area_m2: float


class GlobalStats(BaseModel):
    max_depth_m: float
    max_velocity_m_s: float
    max_inundated_area_m2: float
    total_area_m2: float


class BufferSlice(BaseModel):
    offset_bytes: int
    length: int
    dtype: Literal["float32", "uint32"]


class ResultBuffers(BaseModel):
    mesh_url: str
    frames_url: str
    mesh_bytes: int
    frames_bytes: int
    mesh_layout: dict[str, BufferSlice]
    frames_layout: dict[str, BufferSlice]


class SimulationParamsEcho(BaseModel):
    dem_name: str
    rain_mm_hr: float
    duration_sec: float
    yieldstep_sec: float
    mannings_n: float
    max_triangle_area: float
    boundary_mode: BoundaryMode


class FlowSimResultMetadata(BaseModel):
    job_id: str
    vertex_count: int
    triangle_count: int
    frame_count: int
    times_sec: list[float]
    utm_epsg: int | None = None
    utm_origin: list[float] = Field(min_length=2, max_length=2)
    bounds_local: BoundsLocal
    global_stats: GlobalStats
    frame_stats: list[FrameStat]
    params: SimulationParamsEcho
    buffers: ResultBuffers
