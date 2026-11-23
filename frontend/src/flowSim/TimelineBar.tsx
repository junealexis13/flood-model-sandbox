import { BookOpen, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { formatArea } from "../utils/format";
import { flowDepthRampCss, flowVelocityRampCss } from "./colorMaps";
import type { FlowSimData, PlaybackSpeed, WaterColorMode } from "./types";

interface TimelineBarProps {
  data: FlowSimData;
  frameIndex: number;
  playing: boolean;
  speed: PlaybackSpeed;
  colorMode: WaterColorMode;
  onTogglePlay: () => void;
  onFrameChange: (index: number) => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onColorModeChange: (mode: WaterColorMode) => void;
  onOpenDocs: () => void;
}

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 5];

export function TimelineBar({
  data,
  frameIndex,
  playing,
  speed,
  colorMode,
  onTogglePlay,
  onFrameChange,
  onSpeedChange,
  onColorModeChange,
  onOpenDocs,
}: TimelineBarProps) {
  const { meta } = data;
  const maxIndex = Math.max(0, meta.frame_count - 1);
  const clamped = Math.max(0, Math.min(maxIndex, frameIndex));
  const stat = meta.frame_stats[clamped] ?? {
    time_sec: 0,
    peak_depth_m: 0,
    max_velocity_m_s: 0,
    inundated_area_m2: 0,
  };
  const totalSec = meta.times_sec[maxIndex] ?? meta.params.duration_sec;
  const totalBasinArea = Math.max(1, meta.global_stats.total_area_m2);
  const inundatedPct = (stat.inundated_area_m2 / totalBasinArea) * 100;

  const scaleMax =
    colorMode === "depth"
      ? Math.max(0.5, meta.global_stats.max_depth_m)
      : Math.max(0.5, meta.global_stats.max_velocity_m_s);

  return (
    <div
      role="region"
      aria-label="Simulation timeline and display dock"
      className="pointer-events-auto border border-white/15 bg-[#121816]/88 text-stone-100 shadow-[0_14px_38px_rgba(0,0,0,0.44)] backdrop-blur-md"
    >
      {/* Row 1: Transport + Scrubber + Playback Speed */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
        <div className="inline-flex items-stretch overflow-hidden border border-white/15 bg-white/5">
          <button
            type="button"
            aria-label="Previous frame"
            title="Previous frame (←)"
            onClick={() => onFrameChange(Math.max(0, clamped - 1))}
            className="px-2 py-1 text-stone-300 transition hover:bg-white/10 hover:text-white"
          >
            <SkipBack size={13} />
          </button>
          <button
            type="button"
            aria-label={playing ? "Pause simulation" : "Play simulation"}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            onClick={onTogglePlay}
            className="inline-flex items-center gap-1 border-x border-white/15 bg-tide px-2.5 py-1 text-xs font-medium text-white transition hover:bg-teal-700"
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
            <span>{playing ? "Pause" : "Play"}</span>
          </button>
          <button
            type="button"
            aria-label="Next frame"
            title="Next frame (→)"
            onClick={() => onFrameChange(Math.min(maxIndex, clamped + 1))}
            className="px-2 py-1 text-stone-300 transition hover:bg-white/10 hover:text-white"
          >
            <SkipForward size={13} />
          </button>
        </div>

        <div className="flex min-w-[140px] flex-1 items-center gap-2">
          <span className="font-mono text-xs text-teal-200">{formatClock(stat.time_sec)}</span>
          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={clamped}
            aria-label="Simulation timeline frame"
            onChange={(event) => onFrameChange(Number(event.target.value))}
            className="h-4 flex-1 cursor-pointer"
          />
          <span className="font-mono text-xs text-stone-400">{formatClock(totalSec)}</span>
        </div>

        <div className="inline-flex overflow-hidden border border-white/15 bg-white/5 text-[11px]">
          {SPEEDS.map((s, idx) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={`px-2 py-1 font-mono transition ${
                idx > 0 ? "border-l border-white/15" : ""
              } ${
                speed === s ? "bg-tide text-white" : "text-stone-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Live Summary Stats + Color Mode/Ramp + Technical Note */}
      <div className="flex flex-wrap items-stretch justify-between border-t border-white/15">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3 py-1.5">
          <StatChip label="Peak depth" value={`${stat.peak_depth_m.toFixed(2)} m`} />
          <StatChip label="Max speed" value={`${stat.max_velocity_m_s.toFixed(2)} m/s`} />
          <StatChip
            label="Inundated"
            value={`${formatArea(stat.inundated_area_m2)} (${inundatedPct.toFixed(0)}%)`}
          />
          <StatChip
            label="Mesh"
            value={`${meta.triangle_count.toLocaleString("en-US")} tris`}
          />
        </div>

        <div className="flex flex-wrap items-stretch divide-x divide-white/15 border-t border-white/10 min-[1180px]:border-t-0">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="inline-flex overflow-hidden border border-white/15 bg-white/5 text-[11px]">
              <button
                type="button"
                onClick={() => onColorModeChange("depth")}
                className={`px-2 py-0.5 font-medium transition ${
                  colorMode === "depth" ? "bg-tide text-white" : "text-stone-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Depth
              </button>
              <button
                type="button"
                onClick={() => onColorModeChange("velocity")}
                className={`border-l border-white/15 px-2 py-0.5 font-medium transition ${
                  colorMode === "velocity" ? "bg-tide text-white" : "text-stone-300 hover:bg-white/10 hover:text-white"
                }`}
              >
                Speed
              </button>
            </div>

            <div className="w-[122px]">
              <div
                className="h-2 w-full"
                style={{
                  background: colorMode === "depth" ? flowDepthRampCss() : flowVelocityRampCss(),
                }}
              />
              <div className="mt-1 flex justify-between font-mono text-[10px] leading-none text-stone-300">
                <span>0</span>
                <span>{(scaleMax * 0.5).toFixed(1)}</span>
                <span>
                  {scaleMax.toFixed(1)} {colorMode === "depth" ? "m" : "m/s"}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenDocs}
            className="inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-xs font-medium text-teal-200 transition hover:bg-white/10 hover:text-white"
          >
            <BookOpen size={13} className="shrink-0" />
            <span>Note</span>
          </button>
        </div>
      </div>

      {/* Subtle shortcut bar on wide screens */}
      <div className="hidden items-center justify-between border-t border-white/10 bg-black/20 px-3 py-1 font-mono text-[10px] text-stone-400 min-[1280px]:flex">
        <span>Drag: Orbit · Right-drag: Pan · Scroll: Zoom · Click mesh: Pin hydrograph</span>
        <span>Space: Play/Pause · ←/→: Step · R: Reset view</span>
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[9px] uppercase tracking-[0.16em] text-stone-400">{label}</span>
      <span className="font-mono text-xs text-white">{value}</span>
    </div>
  );
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
