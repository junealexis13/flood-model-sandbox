"""Response models for dataset and upload metadata."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SceneWindowModel(BaseModel):
    col: int
    row: int
    width: int
    height: int


class SceneInfo(BaseModel):
    source_width: int
    source_height: int
    col: int
    row: int
    width: int
    height: int
    max_scene: int


class DatasetSummary(BaseModel):
    dataset_id: str
    source_kind: str
    source_name: str | None = None
    a_basin_m2: float
    bbox: list[float] = Field(min_length=4, max_length=4)
    stream_threshold_km2: float | None = None
    accum_threshold_cells: float | None = None
    width: int
    height: int
    dx_m: float
    dy_m: float
    hand_engine: str | None = None
    scene: SceneInfo
    hand_url: str
    hypsometric_url: str


class UploadPreview(BaseModel):
    upload_id: str
    source_name: str
    width: int
    height: int
    needs_crop: bool
    max_scene: int
    suggested_window: SceneWindowModel
    dx_m: float
    dy_m: float
    utm_epsg: int
    bbox: list[float]
    pixel_area_m2: float
    accum_threshold_cells: float
    stream_threshold_km2: float
    preview_url: str
