export type Amc = "I" | "II" | "III";

export interface CoverPreset {
  id: string;
  label: string;
  cn2: number;
  note: string;
}

export interface SceneWindow {
  col: number;
  row: number;
  width: number;
  height: number;
}

export interface SceneInfo {
  source_width: number;
  source_height: number;
  col: number;
  row: number;
  width: number;
  height: number;
  max_scene: number;
}

export interface HypsometricCurve {
  dataset_id: string;
  source_kind: string;
  source_name?: string | null;
  bbox: [number, number, number, number];
  crs?: string;
  a_basin_m2: number;
  stages_m: number[];
  areas_m2: number[];
  volumes_m3: number[];
  dx_m: number;
  dy_m: number;
  stream_threshold_km2: number | null;
  accum_threshold_cells: number | null;
  hand_engine?: string | null;
  scene: SceneInfo;
  dh_m?: number;
  h_max_m?: number;
}

export interface DatasetSummary {
  dataset_id: string;
  source_kind: string;
  source_name?: string | null;
  a_basin_m2: number;
  bbox: [number, number, number, number];
  stream_threshold_km2: number | null;
  accum_threshold_cells: number | null;
  width: number;
  height: number;
  dx_m: number;
  dy_m: number;
  hand_engine?: string | null;
  scene: SceneInfo;
  hand_url: string;
  hypsometric_url: string;
}

export interface UploadPreview {
  upload_id: string;
  source_name: string;
  width: number;
  height: number;
  needs_crop: boolean;
  max_scene: number;
  suggested_window: SceneWindow;
  dx_m: number;
  dy_m: number;
  utm_epsg: number;
  bbox: [number, number, number, number];
  pixel_area_m2: number;
  accum_threshold_cells: number;
  stream_threshold_km2: number;
  preview_url: string;
}

export interface HandGrid {
  data: Float32Array;
  width: number;
  height: number;
  bbox3857: [number, number, number, number];
  nodata: number;
}

export interface StageSolution {
  qMm: number;
  vInM3: number;
  hM: number;
  floodedAreaM2: number;
  capped: boolean;
}

export interface ClickSample {
  lng: number;
  lat: number;
  hand: number | null;
  depth: number | null;
}
