import { useEffect, useState } from "react";
import type { DatasetSummary, SampleChoice, SamplePreview, SceneWindow } from "../types/flood";
import { apiUrl, readError } from "../api/client";
import { CropSelector, MAX_SCENE, clampWindow, cropAxisSummary } from "./CropSelector";

interface SampleCropModalProps {
  sample: SampleChoice;
  initialWindow?: SceneWindow | null;
  streamKm2: number;
  accumCells: number | null;
  onStreamKm2: (value: number) => void;
  onAccumCells: (value: number | null) => void;
  onClose: () => void;
  onProcessed: (summary: DatasetSummary, sample: SampleChoice) => void;
}

export function SampleCropModal({
  sample,
  initialWindow,
  streamKm2,
  accumCells,
  onStreamKm2,
  onAccumCells,
  onClose,
  onProcessed,
}: SampleCropModalProps) {
  const [preview, setPreview] = useState<SamplePreview | null>(null);
  const [window, setWindow] = useState<SceneWindow | null>(null);
  const [busy, setBusy] = useState<string | null>("Reading sample raster preview…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPreview(null);
    setWindow(null);
    setError(null);
    setBusy("Reading sample raster preview…");

    const params = new URLSearchParams({
      stream_threshold_km2: String(streamKm2),
    });
    fetch(apiUrl(`/api/samples/${encodeURIComponent(sample.id)}/inspect?${params.toString()}`))
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as SamplePreview;
      })
      .then((next) => {
        if (!active) return;
        setPreview(next);
        setWindow(clampWindow(initialWindow ?? next.suggested_window, next.width, next.height));
        if (accumCells == null) {
          const derived = Math.max(1, Math.round((streamKm2 * 1e6) / next.pixel_area_m2));
          onAccumCells(derived);
        }
      })
      .catch((exc) => {
        if (!active) return;
        setError(exc instanceof Error ? exc.message : "Could not inspect that sample DEM.");
      })
      .finally(() => {
        if (active) setBusy(null);
      });

    return () => {
      active = false;
    };
    // Inspect once per sample open; threshold inputs stay reactive below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

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

  async function processSampleWindow() {
    if (!preview || !window) return;
    setError(null);
    setBusy("Filling pits, tracing D8 flow, and building HAND…");
    const params = new URLSearchParams({
      sample_id: sample.id,
      col: String(window.col),
      row: String(window.row),
      width: String(window.width),
      height: String(window.height),
      stream_threshold_km2: String(streamKm2),
    });
    if (accumCells != null) {
      params.set("accum_threshold_cells", String(accumCells));
    }
    try {
      const response = await fetch(apiUrl(`/api/datasets/sample?${params.toString()}`), {
        method: "POST",
      });
      if (!response.ok) throw new Error(await readError(response));
      const summary = (await response.json()) as DatasetSummary;
      onProcessed(summary, sample);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not compute HAND for that window.");
    } finally {
      setBusy(null);
    }
  }

  const sceneCells = window ? window.width * window.height : 0;
  const cells = accumCells ?? (preview ? Math.round((streamKm2 * 1e6) / preview.pixel_area_m2) : null);
  const thresholdTooHigh = cells != null && sceneCells > 0 && cells > sceneCells;

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#121816]/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Select AOI window for ${sample.name}`}
    >
      <div className="my-6 w-[min(680px,100%)] border border-[#e4d8c4] bg-paper p-4 text-ink shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-tide">
              AOI Window · Limit {MAX_SCENE}×{MAX_SCENE} px
            </p>
            <h2 className="font-display text-2xl">{sample.name}</h2>
          </div>
          <button
            type="button"
            disabled={Boolean(busy)}
            className="text-sm text-stone-500 hover:text-ink disabled:opacity-40"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        {preview && window && (
          <div className="mt-3">
            <p className="text-sm leading-relaxed text-stone-700">
              This raster is{" "}
              <span className="font-mono text-ink">
                {preview.width}×{preview.height}
              </span>{" "}
              px (~{preview.dx_m.toFixed(1)} m × {preview.dy_m.toFixed(1)} m).{" "}
              {cropAxisSummary(preview.width, preview.height)}
            </p>

            <div className="mt-3">
              <CropSelector
                previewUrl={apiUrl(preview.preview_url)}
                rasterWidth={preview.width}
                rasterHeight={preview.height}
                dxM={preview.dx_m}
                dyM={preview.dy_m}
                value={window}
                onChange={setWindow}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-[#e4d8c4] pt-3">
              <label className="text-[10px] uppercase tracking-wide text-stone-500">
                Drainage area (km²)
                <input
                  type="number"
                  min={0.0001}
                  step={0.01}
                  value={streamKm2}
                  disabled={Boolean(busy)}
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
                  disabled={Boolean(busy)}
                  placeholder="From km²"
                  className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
                  onChange={(event) => updateCells(Number(event.target.value))}
                />
              </label>
            </div>

            {thresholdTooHigh && (
              <div className="mt-3 border border-copper/40 bg-orange-50 p-2 text-sm text-copper">
                <p>
                  {cells?.toLocaleString("en-US")} cells is larger than this {window.width}×{window.height} window, so
                  no stream can form.
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

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={Boolean(busy)}
                className="border border-stone-300 bg-white px-3 py-2 text-sm text-ink hover:bg-stone-50 disabled:opacity-50"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                className="bg-tide px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                onClick={() => void processSampleWindow()}
              >
                {busy ? "Computing…" : `Compute AOI (${window.width}×${window.height})`}
              </button>
            </div>
          </div>
        )}

        {busy && <p className="mt-3 text-sm text-tide">{busy}</p>}
        {error && <p className="mt-3 border border-copper/40 bg-orange-50 px-2.5 py-2 text-sm text-copper">{error}</p>}
      </div>
    </div>
  );
}
