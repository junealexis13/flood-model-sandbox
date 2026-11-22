import { useState } from "react";
import type { DatasetSummary, SceneWindow, UploadPreview } from "../types/flood";
import { apiUrl, readError } from "../api/client";
import { CropSelector, clampWindow } from "./CropSelector";

interface UploadModalProps {
  streamKm2: number;
  accumCells: number | null;
  onStreamKm2: (value: number) => void;
  onAccumCells: (value: number | null) => void;
  onClose: () => void;
  onProcessed: (summary: DatasetSummary) => void;
}

type Kind = "dem" | "hand";

export function UploadModal({
  streamKm2,
  accumCells,
  onStreamKm2,
  onAccumCells,
  onClose,
  onProcessed,
}: UploadModalProps) {
  const [kind, setKind] = useState<Kind>("dem");
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [window, setWindow] = useState<SceneWindow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("Reading the GeoTIFF…");
    setPreview(null);
    const body = new FormData();
    body.set("file", file);
    body.set("stream_threshold_km2", String(streamKm2));
    try {
      const response = await fetch(apiUrl("/api/uploads"), { method: "POST", body });
      if (!response.ok) throw new Error(await readError(response));
      const next = (await response.json()) as UploadPreview;
      setPreview(next);
      setWindow(clampWindow(next.suggested_window, next.width, next.height));
      if (accumCells == null) {
        const derived = Math.max(1, Math.round((streamKm2 * 1e6) / next.pixel_area_m2));
        onAccumCells(derived);
      }
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not read that GeoTIFF.");
    } finally {
      setBusy(null);
    }
  }

  function updateKm2(value: number) {
    onStreamKm2(value);
    if (preview && value > 0) {
      onAccumCells(Math.max(1, Math.round((value * 1e6) / preview.pixel_area_m2)));
    }
  }

  function updateCells(value: number) {
    const cells = Math.max(1, Math.round(value));
    onAccumCells(cells);
    if (preview) onStreamKm2((cells * preview.pixel_area_m2) / 1e6);
  }

  async function processScene() {
    if (!preview || !window) return;
    setError(null);
    setBusy(kind === "dem" ? "Filling pits, tracing D8 flow, and building HAND…" : "Building the stage curve…");
    const body = new FormData();
    body.set("kind", kind);
    body.set("upload_id", preview.upload_id);
    body.set("stream_threshold_km2", String(streamKm2));
    if (accumCells != null && kind === "dem") {
      body.set("accum_threshold_cells", String(accumCells));
    }
    if (preview.needs_crop) {
      body.set("col", String(window.col));
      body.set("row", String(window.row));
      body.set("width", String(window.width));
      body.set("height", String(window.height));
    }
    try {
      const response = await fetch(apiUrl("/api/datasets"), { method: "POST", body });
      if (!response.ok) throw new Error(await readError(response));
      onProcessed((await response.json()) as DatasetSummary);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Processing failed.");
    } finally {
      setBusy(null);
    }
  }

  const scene = preview && window
    ? preview.needs_crop
      ? window
      : { col: 0, row: 0, width: preview.width, height: preview.height }
    : null;
  const sceneCells = scene ? scene.width * scene.height : 0;
  const cells = accumCells ?? (preview ? Math.round((streamKm2 * 1e6) / preview.pixel_area_m2) : null);
  const thresholdTooHigh = kind === "dem" && cells != null && sceneCells > 0 && cells > sceneCells;

  return (
    <div className="pointer-events-auto fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-[#121816]/70 p-4">
      <div className="mt-6 w-[min(640px,100%)] border border-[#e4d8c4] bg-paper p-4 text-ink shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-tide">Scene limit 512×512</p>
            <h2 className="font-display text-2xl">Bring a GeoTIFF</h2>
          </div>
          <button type="button" className="text-sm text-stone-500" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`px-3 py-2 text-left text-sm ${kind === "dem" ? "bg-ink text-paper" : "bg-white"}`}
            onClick={() => setKind("dem")}
          >
            Raw DEM
            <span className="mt-1 block text-[11px] opacity-80">Pit-fill, D8, accumulation, then HAND.</span>
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-left text-sm ${kind === "hand" ? "bg-ink text-paper" : "bg-white"}`}
            onClick={() => setKind("hand")}
          >
            HAND raster
            <span className="mt-1 block text-[11px] opacity-80">Already height above drainage.</span>
          </button>
        </div>

        <label className="mt-3 block text-sm">
          GeoTIFF
          <input
            type="file"
            accept=".tif,.tiff,image/tiff"
            className="mt-1 block w-full text-sm"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>

        {kind === "dem" && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Drainage area (km²)
              <input
                type="number"
                min={0.0001}
                step={0.01}
                value={streamKm2}
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
                onChange={(event) => updateKm2(Number(event.target.value))}
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Pixel accumulation (cells)
              <input
                type="number"
                min={1}
                step={1}
                value={accumCells ?? ""}
                placeholder="From km²"
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
                onChange={(event) => updateCells(Number(event.target.value))}
              />
            </label>
          </div>
        )}

        {preview && (
          <div className="mt-4">
            <p className="text-sm text-stone-700">
              {preview.source_name} is {preview.width}×{preview.height} px, about {preview.dx_m.toFixed(1)} m by{" "}
              {preview.dy_m.toFixed(1)} m.
              {preview.needs_crop
                ? " It is larger than 512×512, so choose the window to compute."
                : " That is within 512×512, so the whole scene is computed."}
            </p>
            {preview.needs_crop && window && (
              <div className="mt-3">
                <CropSelector
                  previewUrl={apiUrl(preview.preview_url)}
                  rasterWidth={preview.width}
                  rasterHeight={preview.height}
                  value={window}
                  onChange={setWindow}
                />
              </div>
            )}
            {thresholdTooHigh && scene && (
              <div className="mt-3 border border-copper/40 bg-orange-50 p-2 text-sm text-copper">
                <p>
                  {cells?.toLocaleString("en-US")} cells is larger than this {scene.width}×{scene.height} window, so no
                  stream can form.
                </p>
                <button
                  type="button"
                  className="mt-2 border border-copper px-2 py-1 text-xs"
                  onClick={() => updateCells(Math.max(1, Math.round(sceneCells * 0.02)))}
                >
                  Use 2% of the window ({Math.max(1, Math.round(sceneCells * 0.02)).toLocaleString("en-US")} cells)
                </button>
              </div>
            )}
            <button
              type="button"
              disabled={Boolean(busy)}
              className="mt-3 bg-tide px-3 py-2 text-sm text-white disabled:opacity-60"
              onClick={() => void processScene()}
            >
              {preview.needs_crop ? `Compute ${window?.width}×${window?.height}` : "Compute full scene"}
            </button>
          </div>
        )}

        {busy && <p className="mt-3 text-sm text-tide">{busy}</p>}
        {error && <p className="mt-3 text-sm text-copper">{error}</p>}
      </div>
    </div>
  );
}
