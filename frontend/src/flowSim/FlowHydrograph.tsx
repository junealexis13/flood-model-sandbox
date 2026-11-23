import { useMemo, useRef, useState, type PointerEvent } from "react";
import { formatArea } from "../utils/format";
import type { FlowSimResultMetadata, PointSeriesSample } from "./types";

type HydrographMetric = "depth" | "area" | "velocity";

interface FlowHydrographProps {
  meta: FlowSimResultMetadata;
  frameIndex: number;
  onSelectFrame: (index: number) => void;
}

export function FlowHydrograph({ meta, frameIndex, onSelectFrame }: FlowHydrographProps) {
  const [metric, setMetric] = useState<HydrographMetric>("depth");
  const draggingRef = useRef(false);

  const width = 280;
  const height = 136;
  const pad = { left: 36, right: 8, top: 10, bottom: 22 };

  const stats = meta.frame_stats;
  const frameCount = Math.max(1, stats.length);
  const clamped = Math.max(0, Math.min(frameCount - 1, frameIndex));
  const totalArea = Math.max(1, meta.global_stats.total_area_m2);

  const chart = useMemo(() => {
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const values = stats.map((s) => {
      if (metric === "depth") return s.peak_depth_m;
      if (metric === "velocity") return s.max_velocity_m_s;
      return (s.inundated_area_m2 / totalArea) * 100;
    });

    const rawMax = values.reduce((acc, v) => Math.max(acc, v), 0);
    const yMax =
      metric === "area"
        ? Math.min(100, Math.max(5, Math.ceil(rawMax / 5) * 5))
        : Math.max(0.2, rawMax * 1.15);

    const xOf = (idx: number) =>
      frameCount <= 1 ? pad.left : pad.left + (idx / (frameCount - 1)) * innerW;
    const yOf = (val: number) => pad.top + (1 - Math.min(val, yMax) / yMax) * innerH;

    const line = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
    const fill =
      values.length > 0
        ? [
            `${xOf(0).toFixed(1)},${yOf(0).toFixed(1)}`,
            ...values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`),
            `${xOf(values.length - 1).toFixed(1)},${yOf(0).toFixed(1)}`,
          ].join(" ")
        : "";

    return { values, yMax, rawMax, xOf, yOf, line, fill };
  }, [stats, metric, totalArea, frameCount]);

  function scrubFromEvent(event: PointerEvent<SVGSVGElement>) {
    if (frameCount <= 1) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const xSvg = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (xSvg - pad.left) / (width - pad.left - pad.right);
    const idx = Math.round(Math.max(0, Math.min(1, ratio)) * (frameCount - 1));
    onSelectFrame(idx);
  }

  const currentStat = stats[clamped];
  const currentVal = chart.values[clamped] ?? 0;
  const currentShare = currentStat ? (currentStat.inundated_area_m2 / totalArea) * 100 : 0;
  const peakShare = (meta.global_stats.max_inundated_area_m2 / totalArea) * 100;
  const totalSec = meta.times_sec[frameCount - 1] ?? meta.params.duration_sec;

  const ticks = [0, chart.yMax / 2, chart.yMax];

  const currentLabel =
    metric === "depth"
      ? `${currentVal.toFixed(2)} m`
      : metric === "velocity"
        ? `${currentVal.toFixed(2)} m/s`
        : `${currentShare.toFixed(1)}% (${formatArea(currentStat?.inundated_area_m2 ?? 0)})`;

  const peakLabel =
    metric === "depth"
      ? `Peak ${meta.global_stats.max_depth_m.toFixed(2)} m`
      : metric === "velocity"
        ? `Peak ${meta.global_stats.max_velocity_m_s.toFixed(2)} m/s`
        : `Peak ${peakShare.toFixed(1)}%`;

  return (
    <figure>
      <div className="flex items-center justify-between gap-2">
        <figcaption className="whitespace-nowrap text-[10px] uppercase tracking-[0.18em] text-tide">
          Hydrograph
        </figcaption>
        <div className="inline-flex shrink-0 overflow-hidden border border-[#e4d8c4] bg-white text-[10px]">
          {(
            [
              ["depth", "Depth"],
              ["area", "Area %"],
              ["velocity", "Speed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetric(id)}
              className={`whitespace-nowrap px-2 py-0.5 transition ${
                metric === id ? "bg-tide text-white" : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between font-mono text-[11px]">
        <span className="font-medium text-ink">{currentLabel}</span>
        <span className="text-stone-500">{peakLabel}</span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1 w-full cursor-ew-resize touch-none select-none"
        role="img"
        aria-label={`Basin ${metric} hydrograph over simulation time`}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          scrubFromEvent(e);
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) scrubFromEvent(e);
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={chart.yOf(tick)}
              y2={chart.yOf(tick)}
              stroke="#e4dccb"
              strokeWidth="1"
            />
            <text
              x={pad.left - 5}
              y={chart.yOf(tick) + 3}
              textAnchor="end"
              fontSize="9"
              fill="#6b6459"
              fontFamily="IBM Plex Mono, monospace"
            >
              {metric === "area" ? `${tick.toFixed(0)}%` : tick.toFixed(tick >= 10 ? 0 : 1)}
            </text>
          </g>
        ))}

        {chart.fill && <polygon points={chart.fill} fill="#0f766e" opacity="0.18" />}
        {chart.line && (
          <polyline points={chart.line} fill="none" stroke="#0f766e" strokeWidth="2" strokeLinejoin="round" />
        )}

        <line
          x1={chart.xOf(clamped)}
          x2={chart.xOf(clamped)}
          y1={pad.top}
          y2={height - pad.bottom}
          stroke="#9a3412"
          strokeDasharray="3 3"
          strokeWidth="1.2"
        />
        <circle cx={chart.xOf(clamped)} cy={chart.yOf(currentVal)} r="3.8" fill="#9a3412" />

        <text
          x={pad.left}
          y={height - 6}
          fontSize="9"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          00:00
        </text>
        <text
          x={width - pad.right}
          y={height - 6}
          textAnchor="end"
          fontSize="9"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          {formatClockShort(totalSec)}
        </text>
      </svg>

      <p className="font-mono text-[10px] text-stone-500">
        {currentShare.toFixed(1)}% flooded now · {peakShare.toFixed(1)}% peak of {formatArea(totalArea)}
      </p>
    </figure>
  );
}

interface PointHydrographProps {
  series: PointSeriesSample[];
  frameIndex: number;
  onSelectFrame: (index: number) => void;
}

export function PointHydrograph({ series, frameIndex, onSelectFrame }: PointHydrographProps) {
  const width = 256;
  const height = 84;
  const pad = { left: 30, right: 6, top: 8, bottom: 16 };
  const n = series.length;
  const clamped = Math.max(0, Math.min(Math.max(0, n - 1), frameIndex));

  const geom = useMemo(() => {
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    let maxD = 0;
    let maxV = 0;
    for (const s of series) {
      if (s.depthM > maxD) maxD = s.depthM;
      if (s.velocityMS > maxV) maxV = s.velocityMS;
    }
    const dCap = Math.max(0.1, maxD * 1.15);
    const vCap = Math.max(0.1, maxV * 1.15);

    const xOf = (i: number) => (n <= 1 ? pad.left : pad.left + (i / (n - 1)) * innerW);
    const yD = (d: number) => pad.top + (1 - Math.min(d, dCap) / dCap) * innerH;
    const yV = (v: number) => pad.top + (1 - Math.min(v, vCap) / vCap) * innerH;

    const dLine = series.map((s, i) => `${xOf(i).toFixed(1)},${yD(s.depthM).toFixed(1)}`).join(" ");
    const dFill =
      n > 0
        ? [
            `${xOf(0).toFixed(1)},${yD(0).toFixed(1)}`,
            ...series.map((s, i) => `${xOf(i).toFixed(1)},${yD(s.depthM).toFixed(1)}`),
            `${xOf(n - 1).toFixed(1)},${yD(0).toFixed(1)}`,
          ].join(" ")
        : "";
    const vLine = series.map((s, i) => `${xOf(i).toFixed(1)},${yV(s.velocityMS).toFixed(1)}`).join(" ");

    return { maxD, maxV, dCap, xOf, yD, yV, dLine, dFill, vLine };
  }, [series, n]);

  if (n < 2) return null;
  const active = series[clamped];

  function pickFrame(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const xSvg = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = (xSvg - pad.left) / (width - pad.left - pad.right);
    onSelectFrame(Math.round(Math.max(0, Math.min(1, ratio)) * (n - 1)));
  }

  return (
    <div className="mt-2 border-t border-[#e4d8c4] pt-2">
      <div className="flex items-center justify-between text-[10px]">
        <span className="uppercase tracking-[0.14em] text-stone-500">Pinned point over time</span>
        <span className="font-mono text-stone-600">
          Max <span className="text-tide">{geom.maxD.toFixed(2)}m</span> ·{" "}
          <span className="text-copper">{geom.maxV.toFixed(2)}m/s</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-1 w-full cursor-ew-resize select-none"
        role="img"
        aria-label="Pinned point water depth and velocity over time"
        onPointerDown={pickFrame}
      >
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={geom.yD(0)}
          y2={geom.yD(0)}
          stroke="#e4dccb"
          strokeWidth="1"
        />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={geom.yD(geom.dCap)}
          y2={geom.yD(geom.dCap)}
          stroke="#e4dccb"
          strokeWidth="1"
        />
        <text
          x={pad.left - 4}
          y={geom.yD(geom.dCap) + 3}
          textAnchor="end"
          fontSize="8.5"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          {geom.dCap.toFixed(1)}m
        </text>
        <text
          x={pad.left - 4}
          y={geom.yD(0) + 3}
          textAnchor="end"
          fontSize="8.5"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          0
        </text>

        <polygon points={geom.dFill} fill="#0f766e" opacity="0.2" />
        <polyline points={geom.dLine} fill="none" stroke="#0f766e" strokeWidth="1.6" />
        <polyline
          points={geom.vLine}
          fill="none"
          stroke="#9a3412"
          strokeWidth="1.2"
          strokeDasharray="2.5 2"
          opacity="0.85"
        />

        <line
          x1={geom.xOf(clamped)}
          x2={geom.xOf(clamped)}
          y1={pad.top}
          y2={height - pad.bottom}
          stroke="#1c1915"
          strokeWidth="1"
          opacity="0.55"
        />
        {active && (
          <circle cx={geom.xOf(clamped)} cy={geom.yD(active.depthM)} r="3" fill="#0f766e" />
        )}

        <text
          x={pad.left}
          y={height - 3}
          fontSize="8"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          00:00
        </text>
        <text
          x={width - pad.right}
          y={height - 3}
          textAnchor="end"
          fontSize="8"
          fill="#6b6459"
          fontFamily="IBM Plex Mono, monospace"
        >
          {formatClockShort(series[n - 1]?.timeSec ?? 0)}
        </text>
      </svg>
      <div className="flex items-center gap-3 font-mono text-[9px] text-stone-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-1.5 w-3 bg-tide" /> Depth
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 border-t border-dashed border-copper" /> Speed
        </span>
      </div>
    </div>
  );
}

function formatClockShort(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
