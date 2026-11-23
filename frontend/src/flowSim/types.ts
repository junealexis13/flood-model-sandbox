export type JobState = "queued" | "meshing" | "running" | "completed" | "failed";
export type BoundaryMode = "open" | "closed";
export type WaterColorMode = "depth" | "velocity";
export type PlaybackSpeed = 0.5 | 1 | 2 | 5;
export type CameraPreset = "iso" | "top" | "low" | "north";

export interface ActiveHandDem {
  kind: "sample" | "file" | "hand_only";
  label: string;
  sampleId?: string;
  file?: File;
}

export interface FlowSimJobStatus {
  job_id: string;
  state: JobState;
  progress: number;
  sim_time_sec: number;
  duration_sec: number;
  message: string;
  error: string | null;
  dem_name: string | null;
  updated_at: string;
}

export interface BoundsLocal {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
  min_z: number;
  max_z: number;
}

export interface FrameStat {
  time_sec: number;
  peak_depth_m: number;
  max_velocity_m_s: number;
  inundated_area_m2: number;
}

export interface GlobalStats {
  max_depth_m: number;
  max_velocity_m_s: number;
  max_inundated_area_m2: number;
  total_area_m2: number;
}

export interface BufferSlice {
  offset_bytes: number;
  length: number;
  dtype: "float32" | "uint32";
}

export interface ResultBuffers {
  mesh_url: string;
  frames_url: string;
  mesh_bytes: number;
  frames_bytes: number;
  mesh_layout: Record<"x_local" | "y_local" | "elevation" | "indices", BufferSlice>;
  frames_layout: Record<"stage" | "depth" | "speed", BufferSlice>;
}

export interface SimulationParamsEcho {
  dem_name: string;
  rain_mm_hr: number;
  duration_sec: number;
  yieldstep_sec: number;
  mannings_n: number;
  max_triangle_area: number;
  boundary_mode: BoundaryMode;
}

export interface FlowSimResultMetadata {
  job_id: string;
  vertex_count: number;
  triangle_count: number;
  frame_count: number;
  times_sec: number[];
  utm_epsg: number | null;
  utm_origin: [number, number];
  bounds_local: BoundsLocal;
  global_stats: GlobalStats;
  frame_stats: FrameStat[];
  params: SimulationParamsEcho;
  buffers: ResultBuffers;
}

export interface FlowSimData {
  meta: FlowSimResultMetadata;
  xLocal: Float32Array;
  yLocal: Float32Array;
  elevation: Float32Array;
  indices: Uint32Array;
  stage: Float32Array;
  depth: Float32Array;
  speed: Float32Array;
}

export interface FlowSimRequestParams {
  file?: File | null;
  sampleId?: string | null;
  rainMmHr: number;
  durationSec: number;
  yieldstepSec: number;
  manningsN: number;
  maxTriangleArea: number | null;
  boundaryMode: BoundaryMode;
}

export interface PointSeriesSample {
  timeSec: number;
  depthM: number;
  velocityMS: number;
}

export interface PointInspection {
  localX: number;
  localY: number;
  utmEasting: number;
  utmNorthing: number;
  utmEpsg: number | null;
  elevationM: number;
  depthM: number;
  stageM: number;
  velocityMS: number;
  pinned: boolean;
  series?: PointSeriesSample[];
}
