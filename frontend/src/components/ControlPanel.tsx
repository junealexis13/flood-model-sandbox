import { useState } from "react";
import { BookOpen, ChevronDown, CloudRain, Upload } from "lucide-react";
import type { Amc, HypsometricCurve } from "../types/flood";
import { formatArea, formatCells } from "../utils/format";
import { AMC_OPTIONS, COVERS, cnForAmc } from "../utils/hydrology";

interface ControlPanelProps {
  curve: HypsometricCurve | null;
  rainfallMm: number;
  coverId: string;
  amc: Amc;
  cn: number;
  streamKm2: number;
  accumCells: number | null;
  status: string | null;
  error: string | null;
  onRainfall: (value: number) => void;
  onCover: (id: string) => void;
  onAmc: (amc: Amc) => void;
  onCn: (cn: number) => void;
  onStreamKm2: (value: number) => void;
  onAccumCells: (value: number | null) => void;
  onLoadSample: () => void;
  onUpload: () => void;
  onOpenDocs: () => void;
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    curve,
    rainfallMm,
    coverId,
    amc,
    cn,
    streamKm2,
    accumCells,
    status,
    error,
    onRainfall,
    onCover,
    onAmc,
    onCn,
    onStreamKm2,
    onAccumCells,
    onLoadSample,
    onUpload,
    onOpenDocs,
  } = props;
  const [mobileOpen, setMobileOpen] = useState(true);
  const cover = COVERS.find((item) => item.id === coverId);

  return (
    <aside className="max-h-[calc(100vh-16rem)] overflow-y-auto border border-[#e4d8c4] bg-paper/95 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-md min-[900px]:max-h-[calc(100vh-1.5rem)]">
      <header className="border-b border-[#e4d8c4] px-4 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-tide">Height above nearest drainage</p>
            <h1 className="font-display text-[1.7rem] leading-none text-ink">Flood extent</h1>
          </div>
          <button
            type="button"
            className="min-[900px]:hidden border border-stone-300 bg-white px-2 py-1 text-xs"
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? "Hide" : "Controls"}
          </button>
        </div>
        {curve && <p className="mt-2 text-xs leading-snug text-stone-600">{sceneCaption(curve)}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="bg-ink px-3 py-2 text-sm text-paper" onClick={onLoadSample}>
            Load sample
          </button>
          <button type="button" className="inline-flex items-center justify-center gap-1 border border-ink px-3 py-2 text-sm" onClick={onUpload}>
            <Upload size={14} /> Upload
          </button>
        </div>
        <button
          type="button"
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 border border-tide/40 bg-white px-3 py-2 text-sm text-tide"
          onClick={onOpenDocs}
        >
          <BookOpen size={14} />
          Technical note
        </button>
      </header>

      <div className={mobileOpen ? "space-y-3 px-4 py-3" : "hidden space-y-3 px-4 py-3 min-[900px]:block"}>
        {status && <p className="text-sm text-tide">{status}</p>}
        {error && <p className="border border-copper/40 bg-orange-50 px-2 py-1.5 text-sm text-copper">{error}</p>}

        <label className="block">
          <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            <span className="inline-flex items-center gap-1">
              <CloudRain size={13} /> Rainfall
            </span>
            <span className="font-mono text-sm normal-case tracking-normal text-ink">{rainfallMm.toFixed(0)} mm</span>
          </span>
          <input
            className="mt-2"
            type="range"
            min={0}
            max={250}
            step={1}
            value={rainfallMm}
            aria-valuetext={`${rainfallMm} millimetres`}
            onChange={(event) => onRainfall(Number(event.target.value))}
          />
        </label>

        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Land cover</p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {COVERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onCover(item.id)}
                className={`px-2 py-1 text-left text-sm ${coverId === item.id ? "bg-tide text-white" : "bg-white text-ink"}`}
              >
                {item.label}
                <span className={`block font-mono text-[10px] ${coverId === item.id ? "text-teal-100" : "text-stone-500"}`}>
                  CN {item.cn2}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Antecedent moisture</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {AMC_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onAmc(option.id)}
                className={`px-2 py-1.5 text-sm ${amc === option.id ? "bg-ink text-paper" : "bg-white"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            Curve number
            <span className="font-mono text-sm normal-case tracking-normal text-ink">{cn}</span>
          </span>
          <input
            className="mt-2"
            type="range"
            min={35}
            max={98}
            step={1}
            value={cn}
            aria-valuetext={`Curve number ${cn}`}
            onChange={(event) => onCn(Number(event.target.value))}
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-stone-500">
            {cover?.note ?? "Soil group B"}. {AMC_OPTIONS.find((option) => option.id === amc)?.label} moisture starts near CN{" "}
            {Math.round(cnForAmc(cover?.cn2 ?? cn, amc))}.
          </span>
        </label>

        <details className="group border-t border-[#e4d8c4] pt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.14em] text-stone-500">
              <ChevronDown size={13} className="transition group-open:rotate-180" />
              Stream threshold
            </span>
            <span className="font-mono text-xs text-ink">{streamKm2.toFixed(2)} km²</span>
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-stone-600">
            Applied the next time a raw DEM is processed. It chooses the streams. It does not rerun while you change the storm.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Drainage area (km²)
              <input
                type="number"
                min={0.0001}
                step={0.01}
                value={streamKm2}
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm normal-case tracking-normal text-ink"
                onChange={(event) => onStreamKm2(Number(event.target.value))}
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Accumulation (cells)
              <input
                type="number"
                min={1}
                step={1}
                value={accumCells ?? ""}
                placeholder="From km²"
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm normal-case tracking-normal text-ink"
                onChange={(event) => {
                  const next = event.target.value;
                  onAccumCells(next === "" ? null : Number(next));
                }}
              />
            </label>
          </div>
          {curve && (
            <p className="mt-2 text-xs leading-relaxed text-stone-600">
              {curve.accum_threshold_cells
                ? `This scene used ≥ ${formatCells(curve.accum_threshold_cells)} cells (${(curve.stream_threshold_km2 ?? 0).toFixed(2)} km²) on a ${curve.scene.width}×${curve.scene.height} window.`
                : `Precomputed HAND, ${curve.scene.width}×${curve.scene.height} pixels. No stream threshold was applied.`}
            </p>
          )}
        </details>
      </div>
    </aside>
  );
}

function sceneCaption(curve: HypsometricCurve): string {
  const size = `${curve.scene.width}×${curve.scene.height}`;
  const area = formatArea(curve.a_basin_m2);
  if (curve.source_kind === "sample") return `${curve.source_name?.trim() || "Sample"} · ${size} · ${area}`;
  if (curve.source_kind === "hand") return `Uploaded HAND · ${size} · ${area}`;
  return `DEM scene · ${size} · ${area}`;
}
