import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  Camera,
  Compass,
  Eye,
  EyeOff,
  Grid3x3,
  Layers,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Play,
  RotateCcw,
} from "lucide-react";
import type { SampleChoice } from "../types/flood";
import { fetchFlowSimSamples, useFlowSimJob } from "./api";
import { terrainRampCss } from "./colorMaps";
import { FlowHydrograph, PointHydrograph } from "./FlowHydrograph";
import { FlowSimSidebar } from "./FlowSimSidebar";
import { FlowTechDoc } from "./FlowTechDoc";
import { FlowViewport3D } from "./FlowViewport3D";
import { TimelineBar } from "./TimelineBar";
import type {
  ActiveHandDem,
  CameraPreset,
  PlaybackSpeed,
  PointInspection,
  WaterColorMode,
} from "./types";

interface FlowSimPageProps {
  handSamples: SampleChoice[];
  activeHandDem: ActiveHandDem | null;
}

export function FlowSimPage({ handSamples, activeHandDem }: FlowSimPageProps) {
  const { status, data, submitting, loadingResult, error, runSimulation } = useFlowSimJob();
  const [samples, setSamples] = useState<SampleChoice[]>(handSamples);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [colorMode, setColorMode] = useState<WaterColorMode>("depth");
  const [showWireframe, setShowWireframe] = useState(false);
  const [zScale, setZScale] = useState(1.5);
  const [waterOpacity, setWaterOpacity] = useState(0.95);
  const [lastVisibleOpacity, setLastVisibleOpacity] = useState(0.95);
  const [cameraPreset, setCameraPreset] = useState<{ mode: CameraPreset; seq: number }>({
    mode: "iso",
    seq: 0,
  });
  const [northDeg, setNorthDeg] = useState(0);
  const [snapshotSignal, setSnapshotSignal] = useState(0);
  const [inspection, setInspection] = useState<PointInspection | null>(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [docsOpen, setDocsOpen] = useState(false);

  const triggerPreset = useCallback((mode: CameraPreset) => {
    setCameraPreset((prev) => ({ mode, seq: prev.seq + 1 }));
  }, []);

  useEffect(() => {
    if (handSamples.length > 0 && samples.length === 0) {
      setSamples(handSamples);
    }
  }, [handSamples, samples.length]);

  useEffect(() => {
    let active = true;
    fetchFlowSimSamples()
      .then((list) => {
        if (active && list.length > 0) setSamples(list);
      })
      .catch(() => {
        /* Fallback to handSamples if flow-sim service is still booting. */
      });
    return () => {
      active = false;
    };
  }, []);

  // Reset timeline when a fresh simulation result arrives.
  useEffect(() => {
    if (!data) return;
    setFrameIndex(0);
    setPlaying(data.meta.frame_count > 1);
    setInspection(null);
    setRightOpen(true);
  }, [data]);

  // Playback timer loop.
  useEffect(() => {
    if (!playing || !data || data.meta.frame_count <= 1) return;
    const baseIntervalMs = 260;
    const intervalMs = Math.max(35, baseIntervalMs / speed);
    let lastTick = performance.now();
    let rafId = 0;

    const step = (now: number) => {
      rafId = requestAnimationFrame(step);
      if (now - lastTick >= intervalMs) {
        lastTick = now;
        setFrameIndex((prev) => (prev + 1) % data.meta.frame_count);
      }
    };
    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [playing, speed, data]);

  // Global keyboard shortcuts for playback and camera reset.
  useEffect(() => {
    if (!data || docsOpen) return;
    const maxIndex = Math.max(0, data.meta.frame_count - 1);

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        setPlaying((p) => !p);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        setPlaying(false);
        setFrameIndex((prev) => Math.max(0, prev - 1));
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setPlaying(false);
        setFrameIndex((prev) => Math.min(maxIndex, prev + 1));
      } else if (event.key === "r" || event.key === "R") {
        triggerPreset("iso");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, docsOpen, triggerPreset]);

  const isBusy =
    submitting ||
    loadingResult ||
    status?.state === "queued" ||
    status?.state === "meshing" ||
    status?.state === "running";

  const canQuickSyncHand =
    activeHandDem !== null &&
    ((activeHandDem.kind === "sample" && Boolean(activeHandDem.sampleId)) ||
      (activeHandDem.kind === "file" && Boolean(activeHandDem.file)));

  function handleQuickRun(useHandDem: boolean) {
    if (isBusy) return;
    setPlaying(false);
    if (useHandDem && activeHandDem) {
      if (activeHandDem.kind === "file" && activeHandDem.file) {
        void runSimulation({
          file: activeHandDem.file,
          sampleId: null,
          rainMmHr: 80,
          durationSec: 1800,
          yieldstepSec: 60,
          manningsN: 0.035,
          maxTriangleArea: null,
          boundaryMode: "open",
        });
        return;
      }
      if (activeHandDem.kind === "sample" && activeHandDem.sampleId) {
        void runSimulation({
          file: null,
          sampleId: activeHandDem.sampleId,
          rainMmHr: 80,
          durationSec: 1800,
          yieldstepSec: 60,
          manningsN: 0.035,
          maxTriangleArea: null,
          boundaryMode: "open",
        });
        return;
      }
    }
    const defaultSample = samples[0]?.id;
    if (!defaultSample) return;
    void runSimulation({
      file: null,
      sampleId: defaultSample,
      rainMmHr: 80,
      durationSec: 1800,
      yieldstepSec: 60,
      manningsN: 0.035,
      maxTriangleArea: null,
      boundaryMode: "open",
    });
  }

  function toggleWaterVisibility() {
    if (waterOpacity > 0.01) {
      setLastVisibleOpacity(waterOpacity);
      setWaterOpacity(0);
    } else {
      setWaterOpacity(lastVisibleOpacity > 0.05 ? lastVisibleOpacity : 0.95);
    }
  }

  const timelineLeftClass = leftOpen ? "min-[900px]:left-[316px]" : "min-[900px]:left-4";
  const timelineRightClass = data && rightOpen ? "min-[900px]:right-[320px]" : "min-[900px]:right-4";

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#101614]">
      <FlowViewport3D
        data={data}
        frameIndex={frameIndex}
        colorMode={colorMode}
        showWireframe={showWireframe}
        zScale={zScale}
        waterOpacity={waterOpacity}
        cameraPreset={cameraPreset}
        snapshotSignal={snapshotSignal}
        onInspect={setInspection}
        onAzimuthChange={setNorthDeg}
      />

      {/* Empty state guidance with direct quick-start actions */}
      {!data && (
        <div
          className={`pointer-events-none absolute inset-0 flex items-center justify-center p-6 ${
            leftOpen ? "min-[900px]:pl-[320px]" : ""
          }`}
        >
          <div className="pointer-events-auto max-w-md border border-white/15 bg-[#121816]/88 p-6 text-center text-stone-200 shadow-2xl backdrop-blur-md">
            <p className="text-[10px] uppercase tracking-[0.24em] text-teal-300">
              Three.js + ANUGA 2D Solver
            </p>
            <h2 className="mt-2 font-display text-2xl text-paper">
              3D Hydrodynamic Flow Viewport
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">
              Configure rainfall, Manning roughness, and boundaries in the sidebar, or launch a default 30-minute
              storm run right away to inspect 3D wave propagation and hydrographs.
            </p>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {samples.length > 0 && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleQuickRun(false)}
                  className="inline-flex items-center gap-1.5 bg-tide px-3.5 py-2 text-xs font-medium text-white shadow transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Play size={13} />
                  {isBusy ? "Running ANUGA…" : `Quick Run: ${samples[0].name}`}
                </button>
              )}
              {canQuickSyncHand && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => handleQuickRun(true)}
                  className="inline-flex items-center gap-1.5 border border-teal-400/40 bg-teal-950/50 px-3 py-2 text-xs font-medium text-teal-200 transition hover:bg-teal-900/60 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowRightLeft size={13} />
                  Run Active HAND DEM
                </button>
              )}
              <button
                type="button"
                onClick={() => setDocsOpen(true)}
                className="inline-flex items-center gap-1.5 border border-white/15 bg-white/5 px-3 py-2 text-xs text-stone-200 transition hover:bg-white/10"
              >
                <BookOpen size={13} />
                Solver note
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 font-mono text-[10px] text-stone-400">
              <div>Auto UTM mesh</div>
              <div>Depth &amp; speed</div>
              <div>Pinned hydrograph</div>
            </div>
          </div>
        </div>
      )}

      {/* Left Simulation Setup Sidebar (Collapsible on desktop) */}
      {leftOpen ? (
        <div className="pointer-events-auto absolute left-3 top-14 z-20 w-[min(295px,calc(100vw-1.5rem))] min-[900px]:top-3">
          <FlowSimSidebar
            samples={samples}
            activeHandDem={activeHandDem}
            status={status}
            submitting={submitting}
            loadingResult={loadingResult}
            error={error}
            onRun={(params) => {
              setPlaying(false);
              void runSimulation(params);
            }}
            onCollapse={() => setLeftOpen(false)}
            onOpenDocs={() => setDocsOpen(true)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setLeftOpen(true)}
          className="pointer-events-auto absolute left-3 top-14 z-20 inline-flex items-center gap-1.5 border border-[#e4d8c4] bg-paper/95 px-3 py-2 text-xs font-medium text-ink shadow-lg backdrop-blur-md transition hover:bg-white min-[900px]:top-3"
        >
          <PanelLeftOpen size={14} className="text-tide" />
          Setup
        </button>
      )}

      {/* Live North Compass Overlay */}
      {data && (
        <button
          type="button"
          onClick={() => triggerPreset("north")}
          title="Align view to North"
          aria-label="Compass rose — click to align camera facing North"
          className={`pointer-events-auto absolute top-3.5 z-20 hidden h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-[#121816]/85 text-stone-200 shadow-lg backdrop-blur-md transition hover:border-teal-400/50 hover:bg-[#121816] min-[900px]:flex ${
            rightOpen ? "right-[324px]" : "right-4"
          }`}
        >
          <svg
            viewBox="0 0 36 36"
            className="h-9 w-9"
            style={{ transform: `rotate(${northDeg}deg)` }}
          >
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth="1" />
            <polygon points="18,4 21.5,18 18,15.5 14.5,18" fill="#14b8a6" />
            <polygon points="18,32 21.5,18 18,20.5 14.5,18" fill="#78716c" opacity="0.65" />
            <text
              x="18"
              y="11"
              textAnchor="middle"
              fontSize="7"
              fontWeight="700"
              fill="#f3efe6"
              fontFamily="IBM Plex Mono, monospace"
            >
              N
            </text>
          </svg>
        </button>
      )}

      {/* Top-Right Viewport Controls + Basin Hydrograph + Point Inspector (Collapsible) */}
      {data &&
        (rightOpen ? (
          <div className="pointer-events-auto absolute right-3 top-14 z-20 flex max-h-[calc(100vh-11rem)] w-[min(300px,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto pr-0.5 min-[900px]:top-3 min-[900px]:max-h-[calc(100vh-1.5rem)]">
            {/* 3D Display Controls */}
            <div className="border border-[#e4d8c4] bg-paper/95 p-3 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur-md">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-tide">
                  <Layers size={12} /> 3D Display
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSnapshotSignal((n) => n + 1)}
                    title="Save 3D view as PNG"
                    aria-label="Save 3D view as PNG"
                    className="inline-flex items-center border border-stone-300 bg-white p-1 text-stone-600 transition hover:bg-stone-50 hover:text-ink"
                  >
                    <Camera size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowWireframe((w) => !w)}
                    title="Toggle triangular mesh overlay"
                    className={`inline-flex items-center gap-1 border px-1.5 py-1 text-[11px] transition ${
                      showWireframe
                        ? "border-tide bg-tide text-white"
                        : "border-stone-300 bg-white text-ink hover:bg-stone-50"
                    }`}
                  >
                    <Grid3x3 size={11} /> Mesh
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightOpen(false)}
                    title="Hide inspector panel"
                    aria-label="Hide inspector panel"
                    className="inline-flex items-center border border-stone-300 bg-white p-1 text-stone-600 transition hover:bg-stone-50 hover:text-ink"
                  >
                    <PanelRightClose size={12} />
                  </button>
                </div>
              </div>

              {/* Camera Presets */}
              <div className="mt-2 grid grid-cols-4 overflow-hidden border border-stone-300 bg-white text-[11px]">
                {(
                  [
                    ["iso", "Iso"],
                    ["top", "Top"],
                    ["low", "Low"],
                  ] as const
                ).map(([mode, label], idx) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => triggerPreset(mode)}
                    className={`py-1 font-medium transition hover:bg-stone-100 ${
                      idx > 0 ? "border-l border-stone-300" : ""
                    } ${cameraPreset.mode === mode ? "bg-ink text-paper hover:bg-ink" : "text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => triggerPreset("iso")}
                  title="Reset camera (R)"
                  className="inline-flex items-center justify-center gap-1 border-l border-stone-300 py-1 text-stone-600 transition hover:bg-stone-100 hover:text-ink"
                >
                  <RotateCcw size={11} /> Reset
                </button>
              </div>

              {/* Sliders: Vertical exaggeration & Water opacity */}
              <div className="mt-2.5 space-y-2">
                <label className="block">
                  <span className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-stone-500">
                    <span>Vertical exaggeration</span>
                    <span className="font-mono text-xs normal-case text-ink">{zScale.toFixed(1)}×</span>
                  </span>
                  <input
                    type="range"
                    min={1}
                    max={6}
                    step={0.5}
                    value={zScale}
                    onChange={(event) => setZScale(Number(event.target.value))}
                    className="mt-1"
                  />
                </label>

                <label className="block">
                  <span className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-stone-500">
                    <span className="inline-flex items-center gap-1.5">
                      Water opacity
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          toggleWaterVisibility();
                        }}
                        title={waterOpacity > 0.01 ? "Hide water surface" : "Show water surface"}
                        className="inline-flex items-center text-tide hover:text-ink"
                      >
                        {waterOpacity > 0.01 ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                    </span>
                    <span className="font-mono text-xs normal-case text-ink">
                      {Math.round(waterOpacity * 100)}%
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(waterOpacity * 100)}
                    onChange={(event) => setWaterOpacity(Number(event.target.value) / 100)}
                    className="mt-1"
                  />
                </label>
              </div>

              {/* Terrain Elevation Legend */}
              <div className="mt-2.5 border-t border-[#e4d8c4] pt-2">
                <span className="block text-[10px] uppercase tracking-[0.14em] text-stone-500">
                  Terrain elevation
                </span>
                <div className="mt-1 h-2 w-full" style={{ background: terrainRampCss() }} />
                <div className="mt-0.5 flex justify-between font-mono text-[10px] text-stone-600">
                  <span>{data.meta.bounds_local.min_z.toFixed(1)} m</span>
                  <span>
                    {((data.meta.bounds_local.min_z + data.meta.bounds_local.max_z) * 0.5).toFixed(1)} m
                  </span>
                  <span>{data.meta.bounds_local.max_z.toFixed(1)} m</span>
                </div>
              </div>

              <div className="mt-2 border-t border-[#e4d8c4] pt-1.5 font-mono text-[10px] text-stone-600">
                {data.meta.params.dem_name} · {data.meta.params.rain_mm_hr} mm/hr · n=
                {data.meta.params.mannings_n} · {data.meta.params.boundary_mode}
              </div>
            </div>

            {/* Basin Hydrograph Card */}
            <div className="border border-[#e4d8c4] bg-paper/95 p-3 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur-md">
              <FlowHydrograph
                meta={data.meta}
                frameIndex={frameIndex}
                onSelectFrame={(idx) => {
                  setPlaying(false);
                  setFrameIndex(idx);
                }}
              />
            </div>

            {/* Point Inspector Card */}
            <div className="border border-[#e4d8c4] bg-paper/95 p-3 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.34)] backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-tide">
                  <Compass size={12} /> Point Inspector
                </span>
                {inspection?.pinned && (
                  <span className="inline-flex items-center gap-1 font-mono text-[10px] text-copper">
                    <Pin size={10} /> Pinned (dbl-click to clear)
                  </span>
                )}
              </div>

              {inspection ? (
                <>
                  <dl className="mt-2 divide-y divide-[#e4d8c4] text-xs">
                    <InspectorRow
                      label="Elevation"
                      value={`${inspection.elevationM.toFixed(2)} m`}
                    />
                    <InspectorRow
                      label="Water depth"
                      value={
                        inspection.depthM >= 0.005
                          ? `${inspection.depthM.toFixed(3)} m`
                          : "Dry (<0.005 m)"
                      }
                      highlight={inspection.depthM >= 0.005}
                    />
                    <InspectorRow
                      label="Water stage"
                      value={`${inspection.stageM.toFixed(2)} m`}
                    />
                    <InspectorRow
                      label="Flow velocity"
                      value={`${inspection.velocityMS.toFixed(2)} m/s`}
                    />
                    <InspectorRow
                      label={inspection.utmEpsg ? `UTM (${inspection.utmEpsg})` : "UTM / Metric"}
                      value={`${inspection.utmEasting.toFixed(0)} E, ${inspection.utmNorthing.toFixed(0)} N`}
                    />
                    <InspectorRow
                      label="Local offset"
                      value={`${inspection.localX.toFixed(1)} m, ${inspection.localY.toFixed(1)} m`}
                    />
                  </dl>
                  {inspection.pinned && inspection.series && (
                    <PointHydrograph
                      series={inspection.series}
                      frameIndex={frameIndex}
                      onSelectFrame={(idx) => {
                        setPlaying(false);
                        setFrameIndex(idx);
                      }}
                    />
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-stone-600">
                  Hover any point on the 3D mesh to sample values, or click to pin a location and plot its local
                  depth &amp; velocity hydrograph.
                </p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setRightOpen(true)}
            className="pointer-events-auto absolute right-3 top-14 z-20 inline-flex items-center gap-1.5 border border-[#e4d8c4] bg-paper/95 px-3 py-2 text-xs font-medium text-ink shadow-lg backdrop-blur-md transition hover:bg-white min-[900px]:top-3"
          >
            <PanelRightOpen size={14} className="text-tide" />
            Display &amp; Charts
          </button>
        ))}

      {/* Bottom Timeline Playback Bar — centered cleanly between sidebars */}
      {data && (
        <div
          className={`pointer-events-none absolute bottom-3 left-3 right-3 z-20 flex justify-center ${timelineLeftClass} ${timelineRightClass}`}
        >
          <div className="w-[min(780px,100%)]">
            <TimelineBar
              data={data}
              frameIndex={frameIndex}
              playing={playing}
              speed={speed}
              colorMode={colorMode}
              onTogglePlay={() => setPlaying((p) => !p)}
              onFrameChange={(idx) => {
                setPlaying(false);
                setFrameIndex(idx);
              }}
              onSpeedChange={setSpeed}
              onColorModeChange={setColorMode}
              onOpenDocs={() => setDocsOpen(true)}
            />
          </div>
        </div>
      )}

      {docsOpen && <FlowTechDoc onClose={() => setDocsOpen(false)} />}
    </div>
  );
}

function InspectorRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <dt className="text-stone-600">{label}</dt>
      <dd className={`text-right font-mono ${highlight ? "font-medium text-tide" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
