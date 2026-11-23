import { useState } from "react";
import { ArrowRightLeft, BookOpen, CloudRain, PanelLeftClose, Play, Upload, Waves } from "lucide-react";
import type { SampleChoice } from "../types/flood";
import type {
  ActiveHandDem,
  BoundaryMode,
  FlowSimJobStatus,
  FlowSimRequestParams,
} from "./types";

interface FlowSimSidebarProps {
  samples: SampleChoice[];
  activeHandDem: ActiveHandDem | null;
  status: FlowSimJobStatus | null;
  submitting: boolean;
  loadingResult: boolean;
  error: string | null;
  onRun: (params: FlowSimRequestParams) => void;
  onCollapse?: () => void;
  onOpenDocs: () => void;
}

type ResolutionMode = "auto" | "custom";
type InfoTopic = "manning" | "mesh" | "boundary" | null;

const MANNING_PRESETS = [
  { label: "Urban", value: 0.02 },
  { label: "Floodplain", value: 0.035 },
  { label: "Vegetated", value: 0.06 },
];

export function FlowSimSidebar({
  samples,
  activeHandDem,
  status,
  submitting,
  loadingResult,
  error,
  onRun,
  onCollapse,
  onOpenDocs,
}: FlowSimSidebarProps) {
  const [selectedSampleId, setSelectedSampleId] = useState<string>(samples[0]?.id ?? "");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [demSourceNote, setDemSourceNote] = useState<string | null>(null);

  const [rainMmHr, setRainMmHr] = useState<number>(80);
  const [durationMin, setDurationMin] = useState<number>(30);
  const [yieldstepSec, setYieldstepSec] = useState<number>(60);
  const [manningsN, setManningsN] = useState<number>(0.035);
  const [resMode, setResMode] = useState<ResolutionMode>("auto");
  const [maxTriArea, setMaxTriArea] = useState<number>(1500);
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("open");
  const [mobileOpen, setMobileOpen] = useState(true);
  const [info, setInfo] = useState<InfoTopic>(null);

  const effectiveSampleId =
    uploadedFile === null ? selectedSampleId || samples[0]?.id || "" : "";

  const isBusy =
    submitting ||
    loadingResult ||
    status?.state === "queued" ||
    status?.state === "meshing" ||
    status?.state === "running";

  const canImportHandDem =
    activeHandDem !== null &&
    ((activeHandDem.kind === "sample" && Boolean(activeHandDem.sampleId)) ||
      (activeHandDem.kind === "file" && Boolean(activeHandDem.file)));

  const durationSecPreview = Math.max(60, Math.round(durationMin * 60));
  const safeYieldPreview = Math.min(durationSecPreview, Math.max(5, Math.round(yieldstepSec)));
  const totalRainMm = (rainMmHr * durationMin) / 60;
  const estimatedFrames = Math.floor(durationSecPreview / safeYieldPreview) + 1;

  function handleLoadFromHand() {
    if (!activeHandDem) return;
    if (activeHandDem.kind === "sample" && activeHandDem.sampleId) {
      setUploadedFile(null);
      setSelectedSampleId(activeHandDem.sampleId);
      setDemSourceNote(`Synced from HAND: ${activeHandDem.label}`);
    } else if (activeHandDem.kind === "file" && activeHandDem.file) {
      setUploadedFile(activeHandDem.file);
      setDemSourceNote(`Synced from HAND upload: ${activeHandDem.label}`);
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const durationSec = Math.max(60, Math.round(durationMin * 60));
    const safeYield = Math.min(durationSec, Math.max(5, Math.round(yieldstepSec)));
    onRun({
      file: uploadedFile,
      sampleId: uploadedFile ? null : effectiveSampleId || null,
      rainMmHr,
      durationSec,
      yieldstepSec: safeYield,
      manningsN,
      maxTriangleArea: resMode === "custom" ? maxTriArea : null,
      boundaryMode,
    });
  }

  const activeDemLabel = uploadedFile
    ? uploadedFile.name
    : samples.find((s) => s.id === effectiveSampleId)?.name ?? "No DEM selected";

  return (
    <aside className="max-h-[calc(100vh-10rem)] overflow-y-auto border border-[#e4d8c4] bg-paper/95 text-ink shadow-[0_18px_50px_rgba(0,0,0,0.38)] backdrop-blur-md min-[900px]:max-h-[calc(100vh-1.5rem)]">
      <header className="border-b border-[#e4d8c4] px-4 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-tide">
              ANUGA · 2D Shallow Water
            </p>
            <h1 className="font-display text-[1.55rem] leading-none text-ink">
              3D Flow Sim
            </h1>
          </div>
          <div className="flex items-center gap-1">
            {onCollapse && (
              <button
                type="button"
                title="Hide setup sidebar"
                aria-label="Hide setup sidebar"
                onClick={onCollapse}
                className="hidden border border-stone-300 bg-white p-1 text-stone-600 transition hover:bg-stone-50 hover:text-ink min-[900px]:inline-flex"
              >
                <PanelLeftClose size={14} />
              </button>
            )}
            <button
              type="button"
              className="border border-stone-300 bg-white px-2 py-1 text-xs min-[900px]:hidden"
              onClick={() => setMobileOpen((open) => !open)}
            >
              {mobileOpen ? "Hide" : "Setup"}
            </button>
          </div>
        </div>
        <p className="mt-1.5 text-xs leading-snug text-stone-600">
          Unsteady momentum routing, Manning friction, and time-varying flood wave propagation.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className={mobileOpen ? "space-y-3 px-4 py-3" : "hidden space-y-3 px-4 py-3 min-[900px]:block"}
      >
        {/* DEM Source */}
        <div className="space-y-2 border-b border-[#e4d8c4] pb-3">
          <span className="block text-[11px] uppercase tracking-[0.14em] text-stone-500">
            Terrain DEM (.tif / .asc)
          </span>

          {activeHandDem && (
            <button
              type="button"
              disabled={!canImportHandDem || isBusy}
              onClick={handleLoadFromHand}
              className="inline-flex w-full items-center justify-center gap-1.5 border border-tide bg-tide/10 px-2.5 py-1.5 text-xs font-medium text-tide hover:bg-tide/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowRightLeft size={13} />
              Load Current DEM from HAND
            </button>
          )}
          {activeHandDem?.kind === "hand_only" && (
            <p className="text-[11px] leading-snug text-stone-500">
              HAND currently holds a precomputed HAND raster rather than raw elevation. Choose a sample or upload a DEM below.
            </p>
          )}

          <label className="block">
            <span className="text-[10px] uppercase tracking-[0.12em] text-stone-500">Sample basin</span>
            <select
              className="mt-1 w-full border border-stone-300 bg-white px-2 py-1.5 text-sm text-ink disabled:text-stone-400"
              value={effectiveSampleId}
              disabled={samples.length === 0 || isBusy}
              onChange={(event) => {
                setUploadedFile(null);
                setSelectedSampleId(event.target.value);
                setDemSourceNote(null);
              }}
            >
              {samples.length === 0 && <option value="">No sample DEMs found</option>}
              {samples.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex cursor-pointer items-center justify-center gap-1.5 border border-ink px-3 py-1.5 text-xs hover:bg-white">
            <Upload size={13} />
            <span>{uploadedFile ? "Replace DEM file" : "Upload .tif or .asc DEM"}</span>
            <input
              type="file"
              accept=".tif,.tiff,.asc"
              disabled={isBusy}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file) {
                  setUploadedFile(file);
                  setDemSourceNote(null);
                }
              }}
            />
          </label>

          <p className="truncate bg-white/80 px-2 py-1 font-mono text-[11px] text-stone-700" title={activeDemLabel}>
            Active: {activeDemLabel}
          </p>
          {demSourceNote && <p className="text-[11px] text-tide">{demSourceNote}</p>}
        </div>

        {/* Rainfall */}
        <label className="block">
          <span className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            <span className="inline-flex items-center gap-1">
              <CloudRain size={13} /> Rainfall intensity
            </span>
            <span className="font-mono text-sm normal-case tracking-normal text-ink">
              {rainMmHr.toFixed(0)} mm/hr
            </span>
          </span>
          <input
            className="mt-1.5"
            type="range"
            min={5}
            max={300}
            step={5}
            value={rainMmHr}
            disabled={isBusy}
            onChange={(event) => setRainMmHr(Number(event.target.value))}
          />
        </label>

        {/* Duration & Yield step */}
        <div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Duration (min)
              <input
                type="number"
                min={2}
                max={180}
                step={1}
                value={durationMin}
                disabled={isBusy}
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
                onChange={(event) => setDurationMin(Math.max(1, Number(event.target.value)))}
              />
            </label>
            <label className="text-[10px] uppercase tracking-wide text-stone-500">
              Frame step (sec)
              <input
                type="number"
                min={5}
                max={600}
                step={5}
                value={yieldstepSec}
                disabled={isBusy}
                className="mt-1 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
                onChange={(event) => setYieldstepSec(Math.max(5, Number(event.target.value)))}
              />
            </label>
          </div>
          <div className="mt-1.5 flex items-center justify-between border border-[#e4d8c4] bg-white/75 px-2 py-1 font-mono text-[10px] text-stone-600">
            <span>Storm total: {totalRainMm.toFixed(1)} mm</span>
            <span>~{estimatedFrames} frames</span>
          </div>
        </div>

        {/* Manning's n */}
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-stone-500">
            <span className="inline-flex items-center gap-1.5">
              Manning&apos;s n
              <InfoMark
                label="About Manning's roughness"
                open={info === "manning"}
                onToggle={() => setInfo((cur) => (cur === "manning" ? null : "manning"))}
              />
            </span>
            <span className="font-mono text-sm normal-case tracking-normal text-ink">
              {manningsN.toFixed(3)}
            </span>
          </div>
          {info === "manning" && (
            <p className="mt-1.5 border border-[#e4d8c4] bg-white px-2 py-1.5 text-[11px] leading-relaxed text-stone-600">
              Manning&apos;s roughness controls hydraulic drag across the terrain. Lower values (0.02) let water race
              quickly over paved surfaces; higher values (0.06+) slow flow through dense crops or brush and deepen
              transient ponding.
            </p>
          )}
          <input
            className="mt-1.5"
            type="range"
            min={0.015}
            max={0.12}
            step={0.005}
            value={manningsN}
            disabled={isBusy}
            onChange={(event) => setManningsN(Number(event.target.value))}
          />
          <div className="mt-1 grid grid-cols-3 gap-1">
            {MANNING_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={isBusy}
                onClick={() => setManningsN(preset.value)}
                className={`px-1.5 py-1 text-[11px] ${
                  Math.abs(manningsN - preset.value) < 0.002
                    ? "bg-ink text-paper"
                    : "bg-white text-stone-700"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Mesh Resolution */}
        <div>
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-stone-500">
            Mesh resolution
            <InfoMark
              label="About mesh triangle resolution"
              open={info === "mesh"}
              onToggle={() => setInfo((cur) => (cur === "mesh" ? null : "mesh"))}
            />
          </span>
          {info === "mesh" && (
            <p className="mt-1.5 border border-[#e4d8c4] bg-white px-2 py-1.5 text-[11px] leading-relaxed text-stone-600">
              Sets the maximum area (m²) of each finite-volume triangle. Auto targets ~5,500 triangles for responsive
              runs. Smaller custom areas capture narrower channels at the cost of longer solve times (capped at 50k
              triangles).
            </p>
          )}
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setResMode("auto")}
              className={`px-2 py-1 text-xs ${resMode === "auto" ? "bg-tide text-white" : "bg-white text-ink"}`}
            >
              Auto (~5.5k tris)
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setResMode("custom")}
              className={`px-2 py-1 text-xs ${resMode === "custom" ? "bg-tide text-white" : "bg-white text-ink"}`}
            >
              Custom (m²)
            </button>
          </div>
          {resMode === "custom" && (
            <input
              type="number"
              min={10}
              step={50}
              value={maxTriArea}
              disabled={isBusy}
              className="mt-1.5 w-full border border-stone-300 bg-white px-2 py-1 font-mono text-sm text-ink"
              onChange={(event) => setMaxTriArea(Math.max(10, Number(event.target.value)))}
            />
          )}
        </div>

        {/* Boundary Condition */}
        <div>
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-stone-500">
            <Waves size={13} /> Boundary condition
            <InfoMark
              label="About boundary conditions"
              open={info === "boundary"}
              onToggle={() => setInfo((cur) => (cur === "boundary" ? null : "boundary"))}
            />
          </span>
          {info === "boundary" && (
            <p className="mt-1.5 border border-[#e4d8c4] bg-white px-2 py-1.5 text-[11px] leading-relaxed text-stone-600">
              <strong>Open Outflow</strong> lets runoff exit freely across the DEM perimeter.{" "}
              <strong>Closed Basin</strong> treats perimeter edges as reflective walls so all rainfall stays inside the
              basin.
            </p>
          )}
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setBoundaryMode("open")}
              className={`px-2 py-1.5 text-left text-xs ${
                boundaryMode === "open" ? "bg-ink text-paper" : "bg-white text-ink"
              }`}
            >
              Open Outflow
              <span className="block text-[10px] opacity-75">Free edge drainage</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => setBoundaryMode("closed")}
              className={`px-2 py-1.5 text-left text-xs ${
                boundaryMode === "closed" ? "bg-ink text-paper" : "bg-white text-ink"
              }`}
            >
              Closed Basin
              <span className="block text-[10px] opacity-75">Reflective walls</span>
            </button>
          </div>
        </div>

        {/* Submit & Progress */}
        <button
          type="submit"
          disabled={isBusy || (!uploadedFile && !effectiveSampleId)}
          className="inline-flex w-full items-center justify-center gap-1.5 bg-tide px-3 py-2.5 text-sm font-medium text-white shadow hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Play size={14} />
          {isBusy ? "Running ANUGA…" : "Run Simulation"}
        </button>

        {(status || loadingResult) && (
          <div className="border border-[#e4d8c4] bg-white p-2.5">
            <div className="flex items-center justify-between font-mono text-[11px]">
              <span className="uppercase tracking-wider text-tide">
                {loadingResult ? "Streaming buffers" : status?.state ?? "queued"}
              </span>
              <span className="text-ink">
                {loadingResult ? "99%" : `${Math.round(status?.progress ?? 0)}%`}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden bg-stone-200">
              <div
                className="h-full bg-tide transition-all duration-300"
                style={{ width: `${loadingResult ? 99 : Math.max(4, status?.progress ?? 0)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] leading-snug text-stone-600">
              {loadingResult
                ? "Downloading 3D mesh and binary timestep buffers…"
                : status?.message || "Preparing solver…"}
            </p>
          </div>
        )}

        {error && (
          <p className="border border-copper/40 bg-orange-50 px-2.5 py-2 text-xs leading-relaxed text-copper">
            {error}
          </p>
        )}

        <div className="border-t border-[#e4d8c4] pt-2">
          <button
            type="button"
            onClick={onOpenDocs}
            className="inline-flex w-full items-center justify-center gap-1.5 border border-[#e4d8c4] bg-white px-2.5 py-1.5 text-xs font-medium text-tide transition hover:bg-stone-50"
          >
            <BookOpen size={13} />
            Solver Technical Note
          </button>
        </div>
      </form>
    </aside>
  );
}

function InfoMark({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border font-serif text-[9px] italic leading-none tracking-normal ${
        open ? "border-tide bg-tide text-white" : "border-stone-400 text-stone-500"
      }`}
      onClick={onToggle}
    >
      i
    </button>
  );
}
