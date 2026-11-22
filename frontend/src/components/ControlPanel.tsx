import { CloudRain, Upload } from "lucide-react";
import type { Amc, ClickSample, HypsometricCurve, StageSolution } from "../types/flood";
import { formatArea, formatCells, formatMm, formatStage, formatVolume } from "../utils/format";
import { COVERS, cnForAmc } from "../utils/hydrology";
import { HypsometricChart } from "./HypsometricChart";

interface ControlPanelProps {
  curve: HypsometricCurve | null;
  solution: StageSolution | null;
  rainfallMm: number;
  coverId: string;
  amc: Amc;
  cn: number;
  streamKm2: number;
  accumCells: number | null;
  status: string | null;
  error: string | null;
  inspector: ClickSample | null;
  onRainfall: (value: number) => void;
  onCover: (id: string) => void;
  onAmc: (amc: Amc) => void;
  onCn: (cn: number) => void;
  onStreamKm2: (value: number) => void;
  onAccumCells: (value: number | null) => void;
  onLoadSample: () => void;
  onUpload: () => void;
}

export function ControlPanel(props: ControlPanelProps) {
  const {
    curve,
    solution,
    rainfallMm,
    coverId,
    amc,
    cn,
    streamKm2,
    accumCells,
    status,
    error,
    inspector,
    onRainfall,
    onCover,
    onAmc,
    onCn,
    onStreamKm2,
    onAccumCells,
    onLoadSample,
    onUpload,
  } = props;
  const fraction =
    curve && solution && curve.a_basin_m2 > 0 ? solution.floodedAreaM2 / curve.a_basin_m2 : 0;

  return (
    <aside className="pointer-events-auto flex max-h-[calc(100vh-2rem)] w-[min(392px,calc(100vw-2rem))] flex-col overflow-y-auto border border-[#e4d8c4] bg-paper text-ink shadow-2xl">
      <header className="border-b border-[#e4d8c4] px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.22em] text-tide">Height above nearest drainage</p>
        <h1 className="font-display text-3xl leading-none text-ink">Flood extent</h1>
        <p className="mt-2 text-sm leading-snug text-stone-600">
          Rainfall and soil set a stage. The map paints every cell whose HAND is at or below that stage.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="bg-ink px-3 py-2 text-sm text-paper" onClick={onLoadSample}>
            Load sample
          </button>
          <button type="button" className="inline-flex items-center gap-1 border border-ink px-3 py-2 text-sm" onClick={onUpload}>
            <Upload size={14} /> Upload GeoTIFF
          </button>
        </div>
      </header>

      <div className="space-y-4 px-4 py-4">
        {status && <p className="text-sm text-tide">{status}</p>}
        {error && <p className="border border-copper/40 bg-orange-50 px-2 py-1.5 text-sm text-copper">{error}</p>}

        <label className="block">
          <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            <span className="inline-flex items-center gap-1">
              <CloudRain size={13} /> Rainfall
            </span>
            <span className="font-mono text-sm text-ink">{formatMm(rainfallMm)}</span>
          </span>
          <input
            className="mt-2"
            type="range"
            min={0}
            max={250}
            step={1}
            value={rainfallMm}
            aria-valuetext={formatMm(rainfallMm)}
            onChange={(event) => onRainfall(Number(event.target.value))}
          />
        </label>

        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Land cover</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {COVERS.map((cover) => (
              <button
                key={cover.id}
                type="button"
                onClick={() => onCover(cover.id)}
                className={`px-2 py-1.5 text-left text-sm ${coverId === cover.id ? "bg-tide text-white" : "bg-white text-ink"}`}
              >
                {cover.label}
                <span className={`block font-mono text-[10px] ${coverId === cover.id ? "text-teal-100" : "text-stone-500"}`}>
                  CN {cover.cn2}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Antecedent moisture</p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ["I", "Dry"],
                ["II", "Average"],
                ["III", "Wet"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onAmc(id)}
                className={`px-2 py-1.5 text-sm ${amc === id ? "bg-ink text-paper" : "bg-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            Curve number
            <span className="font-mono text-sm text-ink">{cn}</span>
          </span>
          <input
            className="mt-2"
            type="range"
            min={35}
            max={98}
            step={1}
            value={cn}
            onChange={(event) => onCn(Number(event.target.value))}
          />
          <span className="mt-1 block text-[11px] text-stone-500">
            {COVERS.find((cover) => cover.id === coverId)?.note}. AMC {amc} starts near CN{" "}
            {Math.round(cnForAmc(COVERS.find((cover) => cover.id === coverId)?.cn2 ?? cn, amc))}.
          </span>
        </label>

        <dl className="grid grid-cols-2 gap-2">
          <Stat label="Runoff depth" value={solution ? formatMm(solution.qMm) : "—"} />
          <Stat label="Inflow volume" value={solution ? formatVolume(solution.vInM3) : "—"} />
          <Stat label="Stage" value={solution ? formatStage(solution.hM) : "—"} />
          <Stat
            label="Flooded area"
            value={solution ? `${formatArea(solution.floodedAreaM2)} · ${(fraction * 100).toFixed(1)}%` : "—"}
          />
        </dl>
        {solution?.capped && (
          <p className="text-xs text-copper">Inflow is above the 15 m stage curve, so the stage is held at 15 m.</p>
        )}

        {curve && solution && <HypsometricChart curve={curve} stageM={solution.hM} volumeM3={solution.vInM3} />}

        {inspector && (
          <p className="border border-[#e4d8c4] bg-white px-2 py-1.5 font-mono text-xs leading-relaxed">
            {inspector.hand === null
              ? "Click is outside the HAND raster."
              : inspector.depth === null
                ? `HAND ${formatStage(inspector.hand)} · dry at this stage`
                : `HAND ${formatStage(inspector.hand)} · depth ${formatStage(inspector.depth)}`}
          </p>
        )}

        <details className="text-sm text-stone-600">
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.14em] text-stone-500">Runoff equation</summary>
          <p className="mt-2 font-mono text-[11px] leading-relaxed">
            S = 25400/CN − 254
            <br />
            Q = (P − 0.2S)² / (P + 0.8S) when P &gt; 0.2S, else 0
            <br />
            V = Q / 1000 × basin area
          </p>
          <p className="mt-2 text-xs leading-relaxed">
            Stage is the height on the stored curve whose volume matches V. Moving these sliders does not call the server.
          </p>
        </details>

        <div className="border border-[#e4d8c4] bg-white p-3">
          <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500">Stream threshold for the next DEM</p>
          <p className="mt-1 text-xs leading-relaxed text-stone-600">
            Cells with upstream accumulation at or above this count become streams. HAND is the drop to the first stream
            downstream. The threshold does not skip pixels, and it is not sent while you drag rainfall.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Drainage area (km²)
              <input
                type="number"
                min={0.0001}
                step={0.01}
                value={streamKm2}
                className="mt-1 w-full border border-stone-300 px-2 py-1 font-mono text-sm text-ink"
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
                className="mt-1 w-full border border-stone-300 px-2 py-1 font-mono text-sm text-ink"
                onChange={(event) => {
                  const next = event.target.value;
                  onAccumCells(next === "" ? null : Number(next));
                }}
              />
            </label>
          </div>
          {curve && (
            <p className="mt-2 text-xs text-stone-600">
              {curve.source_kind === "sample" && "Synthetic valley placed near Bay, Laguna for the basemap. "}
              {curve.accum_threshold_cells
                ? `This dataset used ≥ ${formatCells(curve.accum_threshold_cells)} cells (${(curve.stream_threshold_km2 ?? 0).toFixed(2)} km²) on a ${curve.scene.width}×${curve.scene.height} window.`
                : `Precomputed HAND, ${curve.scene.width}×${curve.scene.height} pixels. No stream threshold was applied.`}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white px-2 py-2">
      <dt className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</dt>
      <dd className="mt-1 font-mono text-sm leading-tight text-ink">{value}</dd>
    </div>
  );
}
