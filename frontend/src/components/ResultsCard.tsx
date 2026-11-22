import type { Amc, ClickSample, HypsometricCurve, StageSolution } from "../types/flood";
import { formatArea, formatMm, formatStage, formatVolume } from "../utils/format";
import { depthRampCss } from "../utils/cogRenderer";
import { AMC_OPTIONS } from "../utils/hydrology";
import { HypsometricChart } from "./HypsometricChart";

interface ResultsCardProps {
  curve: HypsometricCurve | null;
  solution: StageSolution | null;
  rainfallMm: number;
  amc: Amc;
  cn: number;
  inspector: ClickSample | null;
}

export function ResultsCard({ curve, solution, rainfallMm, amc, cn, inspector }: ResultsCardProps) {
  const moisture = AMC_OPTIONS.find((option) => option.id === amc)?.label ?? amc;
  const fraction = curve && solution && curve.a_basin_m2 > 0 ? solution.floodedAreaM2 / curve.a_basin_m2 : 0;
  const stage = solution ? formatStage(solution.hM) : "—";
  const runoff = solution ? formatMm(solution.qMm) : "—";
  const inflow = solution ? formatVolume(solution.vInM3) : "—";
  const flooded = solution ? formatArea(solution.floodedAreaM2) : "—";
  const share = solution ? `${(fraction * 100).toFixed(1)}% of the scene` : "—";
  const context = `${formatMm(rainfallMm)} · CN ${cn} · ${moisture.toLowerCase()} moisture`;

  return (
    <aside className="border border-[#e4d8c4] bg-paper/95 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.32)] backdrop-blur-md min-[900px]:max-h-[calc(100vh-12.5rem)] min-[900px]:overflow-y-auto">
      <div className="px-3 py-2.5 min-[900px]:hidden">
        <p className="font-mono text-[11px] text-stone-500">{context}</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
          <MobileStat label="Stage" value={stage} emphasize />
          <MobileStat label="Runoff" value={runoff} />
          <MobileStat label="Inflow" value={inflow} />
          <MobileStat label="Flooded" value={flooded} hint={solution ? share : undefined} />
        </dl>
        {solution?.capped && (
          <p className="mt-2 text-xs text-copper">Inflow is above the 15 m curve, so the stage stays at 15 m.</p>
        )}
        <div className="mt-2.5">
          <p className="text-[10px] uppercase tracking-[0.16em] text-stone-500">Water depth</p>
          <div className="mt-1 h-2 w-full" style={{ background: depthRampCss() }} />
          <div className="relative mt-1 h-3.5 font-mono text-[10px] text-stone-500">
            <span className="absolute left-0">0</span>
            <span className="absolute left-[12.5%] -translate-x-1/2">1 m</span>
            <span className="absolute left-[37.5%] -translate-x-1/2">3 m</span>
            <span className="absolute left-[75%] -translate-x-1/2">6 m+</span>
          </div>
        </div>
      </div>

      <div className="hidden px-4 py-3 min-[900px]:block">
        <p className="text-[10px] uppercase tracking-[0.18em] text-tide">This storm</p>
        <p className="mt-1 font-mono text-[11px] text-stone-500">{context}</p>
        <p
          aria-live="polite"
          className={`mt-3 font-mono text-4xl leading-none tracking-tight ${solution?.capped ? "text-copper" : "text-tide"}`}
        >
          {stage}
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.16em] text-stone-500">Stage</p>
        {solution?.capped && (
          <p className="mt-2 text-xs leading-relaxed text-copper">
            Inflow is above the 15 m stage curve, so the stage stays at 15 m.
          </p>
        )}

        <dl className="mt-3 divide-y divide-[#e4d8c4] border-y border-[#e4d8c4]">
          <Metric label="Runoff depth" value={runoff} />
          <Metric label="Inflow volume" value={inflow} />
          <div className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-sm text-stone-600">Flooded area</dt>
              <dd className="text-right font-mono text-sm text-ink">{flooded}</dd>
            </div>
            <p className="text-right font-mono text-[11px] text-stone-500">{share}</p>
          </div>
        </dl>

        {curve && solution && (
          <div className="mt-3">
            <HypsometricChart curve={curve} stageM={solution.hM} volumeM3={solution.vInM3} />
          </div>
        )}

        {inspector && (
          <p className="mt-3 border border-[#e4d8c4] bg-white px-2 py-1.5 font-mono text-xs leading-relaxed">
            {inspector.hand === null
              ? "Click is outside the HAND raster."
              : inspector.depth === null
                ? `HAND ${formatStage(inspector.hand)} · dry at this stage`
                : `HAND ${formatStage(inspector.hand)} · depth ${formatStage(inspector.depth)}`}
          </p>
        )}
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-sm text-stone-600">{label}</dt>
      <dd className="text-right font-mono text-sm text-ink">{value}</dd>
    </div>
  );
}

function MobileStat({
  label,
  value,
  hint,
  emphasize,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.14em] text-stone-500">{label}</dt>
      <dd className={`font-mono text-sm leading-tight ${emphasize ? "text-tide" : "text-ink"}`}>{value}</dd>
      {hint && <p className="font-mono text-[10px] text-stone-500">{hint}</p>}
    </div>
  );
}
