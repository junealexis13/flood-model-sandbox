import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl, readError } from "../api/client";
import type { SampleChoice } from "../types/flood";
import type {
  BufferSlice,
  FlowSimData,
  FlowSimJobStatus,
  FlowSimRequestParams,
  FlowSimResultMetadata,
} from "./types";

export async function fetchFlowSimSamples(): Promise<SampleChoice[]> {
  const response = await fetch(apiUrl("/api/flow-sim/samples"));
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as SampleChoice[];
}

export async function submitFlowSimJob(params: FlowSimRequestParams): Promise<FlowSimJobStatus> {
  const body = new FormData();
  body.set("rain_mm_hr", String(params.rainMmHr));
  body.set("duration_sec", String(params.durationSec));
  body.set("yieldstep_sec", String(params.yieldstepSec));
  body.set("mannings_n", String(params.manningsN));
  body.set("boundary_mode", params.boundaryMode);
  if (params.maxTriangleArea != null && params.maxTriangleArea > 0) {
    body.set("max_triangle_area", String(params.maxTriangleArea));
  }
  if (params.file) {
    body.set("file", params.file);
  } else if (params.sampleId) {
    body.set("sample_id", params.sampleId);
  } else {
    throw new Error("Choose a DEM file or sample basin before running a simulation.");
  }

  const response = await fetch(apiUrl("/api/flow-sim/jobs"), {
    method: "POST",
    body,
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as FlowSimJobStatus;
}

export async function fetchFlowSimStatus(jobId: string): Promise<FlowSimJobStatus> {
  const response = await fetch(apiUrl(`/api/flow-sim/jobs/${encodeURIComponent(jobId)}/status`));
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as FlowSimJobStatus;
}

export async function fetchFlowSimResult(jobId: string): Promise<FlowSimData> {
  const metaResponse = await fetch(apiUrl(`/api/flow-sim/jobs/${encodeURIComponent(jobId)}/result`));
  if (!metaResponse.ok) throw new Error(await readError(metaResponse));
  const meta = (await metaResponse.json()) as FlowSimResultMetadata;

  const [meshRes, framesRes] = await Promise.all([
    fetch(apiUrl(meta.buffers.mesh_url)),
    fetch(apiUrl(meta.buffers.frames_url)),
  ]);
  if (!meshRes.ok) throw new Error(await readError(meshRes));
  if (!framesRes.ok) throw new Error(await readError(framesRes));

  const [meshBuf, framesBuf] = await Promise.all([meshRes.arrayBuffer(), framesRes.arrayBuffer()]);

  const ml = meta.buffers.mesh_layout;
  const fl = meta.buffers.frames_layout;

  return {
    meta,
    xLocal: sliceFloat32(meshBuf, ml.x_local),
    yLocal: sliceFloat32(meshBuf, ml.y_local),
    elevation: sliceFloat32(meshBuf, ml.elevation),
    indices: sliceUint32(meshBuf, ml.indices),
    stage: sliceFloat32(framesBuf, fl.stage),
    depth: sliceFloat32(framesBuf, fl.depth),
    speed: sliceFloat32(framesBuf, fl.speed),
  };
}

function sliceFloat32(buffer: ArrayBuffer, slice: BufferSlice): Float32Array {
  return new Float32Array(buffer, slice.offset_bytes, slice.length);
}

function sliceUint32(buffer: ArrayBuffer, slice: BufferSlice): Uint32Array {
  return new Uint32Array(buffer, slice.offset_bytes, slice.length);
}

export interface UseFlowSimJobReturn {
  status: FlowSimJobStatus | null;
  data: FlowSimData | null;
  submitting: boolean;
  loadingResult: boolean;
  error: string | null;
  runSimulation: (params: FlowSimRequestParams) => Promise<void>;
  clearError: () => void;
}

export function useFlowSimJob(): UseFlowSimJobReturn {
  const [status, setStatus] = useState<FlowSimJobStatus | null>(null);
  const [data, setData] = useState<FlowSimData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimer = useRef<number | null>(null);
  const runToken = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const runSimulation = useCallback(
    async (params: FlowSimRequestParams) => {
      stopPolling();
      const token = ++runToken.current;
      setError(null);
      setSubmitting(true);
      setLoadingResult(false);

      try {
        const initial = await submitFlowSimJob(params);
        if (token !== runToken.current) return;
        setStatus(initial);
        setSubmitting(false);

        const poll = async () => {
          if (token !== runToken.current) return;
          try {
            const next = await fetchFlowSimStatus(initial.job_id);
            if (token !== runToken.current) return;
            setStatus(next);

            if (next.state === "completed") {
              setLoadingResult(true);
              const result = await fetchFlowSimResult(initial.job_id);
              if (token !== runToken.current) return;
              setData(result);
              setLoadingResult(false);
              return;
            }
            if (next.state === "failed") {
              setError(next.error || "The ANUGA simulation failed.");
              return;
            }
            pollTimer.current = window.setTimeout(() => void poll(), 900);
          } catch (exc) {
            if (token !== runToken.current) return;
            setLoadingResult(false);
            setError(exc instanceof Error ? exc.message : "Lost contact with the simulation service.");
          }
        };

        pollTimer.current = window.setTimeout(() => void poll(), 600);
      } catch (exc) {
        if (token !== runToken.current) return;
        setSubmitting(false);
        setError(exc instanceof Error ? exc.message : "Failed to submit simulation job.");
      }
    },
    [stopPolling],
  );

  return {
    status,
    data,
    submitting,
    loadingResult,
    error,
    runSimulation,
    clearError: () => setError(null),
  };
}
