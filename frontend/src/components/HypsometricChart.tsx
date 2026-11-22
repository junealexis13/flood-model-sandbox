import { useMemo, useState, type MouseEvent } from "react";
import type { HypsometricCurve } from "../types/flood";
import { formatArea, formatStage, formatVolume } from "../utils/format";

interface HypsometricChartProps {
  curve: HypsometricCurve;
  stageM: number;
  volumeM3: number;
}

export function HypsometricChart({ curve, stageM, volumeM3 }: HypsometricChartProps) {
  const [hoverStage, setHoverStage] = useState<number | null>(null);
  const width = 320;
  const height = 176;
  const pad = { left: 38, right: 8, top: 14, bottom: 28 };

  const geometry = useMemo(() => {
    const stages = curve.stages_m;
    const volumes = curve.volumes_m3;
    const focus = volumes[Math.min(80, volumes.length - 1)] ?? 1;
    const xMax = Math.max(volumeM3 * 1.25, focus, 1);
    const yMax = Math.min(15, Math.max(stageM * 1.7, 3));
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const xOf = (volume: number) => pad.left + (volume / xMax) * innerW;
    const yOf = (stage: number) => pad.top + (1 - stage / yMax) * innerH;
    const visible: number[] = [];
    for (let index = 0; index < stages.length; index += 1) {
      if (stages[index] > yMax || volumes[index] > xMax) break;
      visible.push(index);
    }
    const line = visible.map((index) => `${xOf(volumes[index]).toFixed(1)},${yOf(stages[index]).toFixed(1)}`).join(" ");
    const fillIndexes = visible.filter((index) => stages[index] <= stageM);
    const fill = [
      `${xOf(0).toFixed(1)},${yOf(0).toFixed(1)}`,
      ...fillIndexes.map((index) => `${xOf(volumes[index]).toFixed(1)},${yOf(stages[index]).toFixed(1)}`),
      `${xOf(Math.min(volumeM3, xMax)).toFixed(1)},${yOf(Math.min(stageM, yMax)).toFixed(1)}`,
      `${xOf(Math.min(volumeM3, xMax)).toFixed(1)},${yOf(0).toFixed(1)}`,
    ].join(" ");
    return { xMax, yMax, xOf, yOf, line, fill, innerW, innerH };
  }, [curve, stageM, volumeM3]);

  function stageAt(event: MouseEvent<SVGSVGElement>): number | null {
    const rect = event.currentTarget.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / rect.height) * height;
    const ratio = (y - pad.top) / (height - pad.top - pad.bottom);
    if (ratio < 0 || ratio > 1) return null;
    return (1 - ratio) * geometry.yMax;
  }

  function volumeAt(stage: number): { volume: number; area: number } {
    const stages = curve.stages_m;
    const volumes = curve.volumes_m3;
    const areas = curve.areas_m2;
    if (stage <= stages[0]) return { volume: volumes[0], area: areas[0] ?? 0 };
    const last = stages.length - 1;
    if (stage >= stages[last]) return { volume: volumes[last], area: areas[last] ?? 0 };
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (stages[mid] <= stage) lo = mid;
      else hi = mid;
    }
    const span = stages[hi] - stages[lo] || 1;
    const t = (stage - stages[lo]) / span;
    return {
      volume: volumes[lo] + t * (volumes[hi] - volumes[lo]),
      area: (areas[lo] ?? 0) + t * ((areas[hi] ?? 0) - (areas[lo] ?? 0)),
    };
  }

  const readout = hoverStage === null ? null : volumeAt(hoverStage);
  const ticks = [0, geometry.yMax / 2, geometry.yMax];

  return (
    <figure>
      <div className="mb-1">
        <figcaption className="text-[11px] uppercase tracking-[0.16em] text-stone-500">Stage–storage</figcaption>
        <p className="font-mono text-[11px] text-stone-600">
          {readout
            ? `${formatStage(hoverStage ?? 0)} · ${formatVolume(readout.volume)}`
            : `${formatStage(stageM)} · ${formatVolume(volumeM3)}`}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full touch-none"
        role="img"
        aria-label={`Hypsometric curve. Current stage ${formatStage(stageM)}, storage ${formatVolume(volumeM3)}.`}
        onMouseMove={(event) => setHoverStage(stageAt(event))}
        onMouseLeave={() => setHoverStage(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={geometry.yOf(tick)}
              y2={geometry.yOf(tick)}
              stroke="#e4dccb"
              strokeWidth="1"
            />
            <text x={pad.left - 6} y={geometry.yOf(tick) + 3} textAnchor="end" fontSize="9" fill="#6b6459">
              {tick.toFixed(tick >= 10 ? 0 : 1)}
            </text>
          </g>
        ))}
        <polygon points={geometry.fill} fill="#0f766e" opacity="0.18" />
        <polyline points={geometry.line} fill="none" stroke="#0f766e" strokeWidth="2" />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={geometry.yOf(stageM)}
          y2={geometry.yOf(stageM)}
          stroke="#9a3412"
          strokeDasharray="3 3"
        />
        <circle cx={geometry.xOf(volumeM3)} cy={geometry.yOf(stageM)} r="4.5" fill="#9a3412" />
        {hoverStage !== null && readout && (
          <circle cx={geometry.xOf(readout.volume)} cy={geometry.yOf(hoverStage)} r="3" fill="#1c1915" />
        )}
        <text x={pad.left} y={height - 8} fontSize="9" fill="#6b6459">
          0
        </text>
        <text x={width - pad.right} y={height - 8} textAnchor="end" fontSize="9" fill="#6b6459">
          {formatVolume(geometry.xMax)}
        </text>
      </svg>
      {readout && (
        <p className="font-mono text-[10px] text-stone-500">
          At {formatStage(hoverStage ?? 0)} the flooded area is {formatArea(readout.area)}.
        </p>
      )}
    </figure>
  );
}
