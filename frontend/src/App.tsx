import { useEffect, useMemo, useRef, useState } from "react";
import { Map, Waves } from "lucide-react";
import { ControlPanel } from "./components/ControlPanel";
import { FloodMap } from "./components/FloodMap";
import { ResultsCard } from "./components/ResultsCard";
import { SampleCropModal } from "./components/SampleCropModal";
import { TechDoc } from "./components/TechDoc";
import { UploadModal } from "./components/UploadModal";
import { FlowSimPage } from "./flowSim/FlowSimPage";
import type { ActiveHandDem } from "./flowSim/types";
import type {
  Amc,
  ClickSample,
  DatasetSummary,
  HandGrid,
  HypsometricCurve,
  SampleChoice,
  SceneWindow,
} from "./types/flood";
import { apiUrl, readError } from "./api/client";
import { readHandCog } from "./utils/cogRenderer";
import { COVERS, cnForAmc, solveStage } from "./utils/hydrology";

type ActiveTool = "hand" | "flow-sim";

function initialToolFromHash(): ActiveTool {
  if (typeof window !== "undefined" && window.location.hash === "#flow-sim") {
    return "flow-sim";
  }
  return "hand";
}

export default function App() {
  const [activeTool, setActiveTool] = useState<ActiveTool>(initialToolFromHash);
  const [flowSimMounted, setFlowSimMounted] = useState<boolean>(() => initialToolFromHash() === "flow-sim");
  const [activeHandDem, setActiveHandDem] = useState<ActiveHandDem | null>(null);

  const [curve, setCurve] = useState<HypsometricCurve | null>(null);
  const [grid, setGrid] = useState<HandGrid | null>(null);
  const [rainfallMm, setRainfallMm] = useState(100);
  const [coverId, setCoverId] = useState("crops");
  const [amc, setAmc] = useState<Amc>("II");
  const [cn, setCn] = useState(78);
  const [streamKm2, setStreamKm2] = useState(1);
  const [accumCells, setAccumCells] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [cropSample, setCropSample] = useState<{
    sample: SampleChoice;
    initialWindow?: SceneWindow | null;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<ClickSample | null>(null);
  const [docsOpen, setDocsOpen] = useState(false);
  const [samples, setSamples] = useState<SampleChoice[]>([]);
  const request = useRef(0);

  const solution = useMemo(
    () => (curve ? solveStage(curve, rainfallMm, cn) : null),
    [curve, rainfallMm, cn],
  );

  useEffect(() => {
    void loadCatalog();
  }, []);

  function selectTool(tool: ActiveTool) {
    setActiveTool(tool);
    if (tool === "flow-sim") setFlowSimMounted(true);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", tool === "flow-sim" ? "#flow-sim" : "#hand");
    }
  }

  async function loadSummary(summary: DatasetSummary) {
    const token = ++request.current;
    setError(null);
    setStatus("Reading the HAND raster…");
    try {
      const [curveResponse, cogResponse] = await Promise.all([
        fetch(apiUrl(summary.hypsometric_url)),
        fetch(apiUrl(summary.hand_url)),
      ]);
      if (!curveResponse.ok) throw new Error(await readError(curveResponse));
      if (!cogResponse.ok) throw new Error(await readError(cogResponse));
      const nextCurve = (await curveResponse.json()) as HypsometricCurve;
      const nextGrid = await readHandCog(await cogResponse.arrayBuffer());
      if (token !== request.current) return;
      setCurve(nextCurve);
      setGrid(nextGrid);
      setInspector(null);
      setStatus(null);
    } catch (exc) {
      if (token !== request.current) return;
      setStatus(null);
      setError(exc instanceof Error ? exc.message : "Could not open that dataset.");
    }
  }

  async function loadCatalog() {
    setError(null);
    try {
      const response = await fetch(apiUrl("/api/samples"));
      if (!response.ok) throw new Error(await readError(response));
      const list = (await response.json()) as SampleChoice[];
      setSamples(list);
      const initial =
        list.find((item) => item.id === "sample") ??
        list.find((item) => !item.needs_crop) ??
        list[0];
      if (!initial) {
        setStatus(null);
        setError("No sample DEMs were found.");
        return;
      }
      if (initial.needs_crop) {
        setCropSample({ sample: initial });
        return;
      }
      await loadSample(initial.id, initial.name);
    } catch (exc) {
      setStatus(null);
      setError(exc instanceof Error ? exc.message : "The sample list did not load.");
    }
  }

  async function loadSample(sampleId: string, name?: string) {
    setError(null);
    setStatus(`Loading ${name ?? "the sample basin"}…`);
    try {
      const response = await fetch(apiUrl(`/api/datasets/sample?sample_id=${encodeURIComponent(sampleId)}`), {
        method: "POST",
      });
      if (!response.ok) {
        const message = await readError(response);
        if (message.includes("choose a window")) {
          const choice = samples.find((item) => item.id === sampleId) ?? {
            id: sampleId,
            name: name ?? sampleId,
            needs_crop: true,
          };
          setStatus(null);
          setCropSample({ sample: choice });
          return;
        }
        throw new Error(message);
      }
      const summary = (await response.json()) as DatasetSummary;
      setActiveHandDem({
        kind: "sample",
        sampleId,
        label: name ?? summary.source_name ?? sampleId,
      });
      await loadSummary(summary);
    } catch (exc) {
      setStatus(null);
      setError(exc instanceof Error ? exc.message : "The sample basin did not load.");
    }
  }

  function chooseCover(id: string) {
    setCoverId(id);
    const cover = COVERS.find((item) => item.id === id);
    if (cover) setCn(Math.round(cnForAmc(cover.cn2, amc)));
  }

  function chooseAmc(next: Amc) {
    setAmc(next);
    const cover = COVERS.find((item) => item.id === coverId);
    if (cover) setCn(Math.round(cnForAmc(cover.cn2, next)));
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#121816]">
      {/* Platform Tool Switcher */}
      <nav
        aria-label="Flood modeling tools"
        className="pointer-events-auto fixed left-1/2 top-3 z-40 flex -translate-x-1/2 overflow-hidden border border-[#e4d8c4] bg-paper/95 text-xs font-medium text-ink shadow-[0_12px_36px_rgba(0,0,0,0.35)] backdrop-blur-md"
      >
        <button
          type="button"
          aria-pressed={activeTool === "hand"}
          onClick={() => selectTool("hand")}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 transition ${
            activeTool === "hand" ? "bg-tide text-white" : "text-ink hover:bg-white"
          }`}
        >
          <Map size={14} />
          <span>HAND Flood Extent</span>
        </button>
        <button
          type="button"
          aria-pressed={activeTool === "flow-sim"}
          onClick={() => selectTool("flow-sim")}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap border-l border-[#e4d8c4] px-3.5 py-2 transition ${
            activeTool === "flow-sim" ? "bg-tide text-white" : "text-ink hover:bg-white"
          }`}
        >
          <Waves size={14} />
          <span>3D Flow Simulation</span>
        </button>
      </nav>

      {/* Tool 1: Existing HAND Tool (intact and state-preserved) */}
      <div className={activeTool === "hand" ? "relative h-screen w-screen overflow-hidden bg-[#121816]" : "hidden"}>
        <FloodMap grid={grid} stageM={solution?.hM ?? 0} onInspect={setInspector} onOpenDocs={() => setDocsOpen(true)} />
        <div className="pointer-events-auto absolute left-3 top-14 z-20 w-[min(280px,calc(100vw-1.5rem))] min-[900px]:top-3">
          <ControlPanel
            curve={curve}
            rainfallMm={rainfallMm}
            coverId={coverId}
            amc={amc}
            cn={cn}
            streamKm2={streamKm2}
            accumCells={accumCells}
            status={status}
            error={error}
            onRainfall={setRainfallMm}
            onCover={chooseCover}
            onAmc={chooseAmc}
            onCn={setCn}
            samples={samples}
            onStreamKm2={setStreamKm2}
            onAccumCells={setAccumCells}
            onSample={(id) => {
              const choice = samples.find((item) => item.id === id);
              if (choice?.needs_crop) {
                setError(null);
                setCropSample({ sample: choice });
                return;
              }
              void loadSample(id, choice?.name);
            }}
            onAdjustSampleAoi={(sample) => {
              setError(null);
              const activeWindow =
                curve && (curve.sample_id ?? curve.dataset_id) === sample.id
                  ? {
                      col: curve.scene.col,
                      row: curve.scene.row,
                      width: curve.scene.width,
                      height: curve.scene.height,
                    }
                  : null;
              setCropSample({ sample, initialWindow: activeWindow });
            }}
            onUpload={() => setUploadOpen(true)}
          />
        </div>
        <div className="pointer-events-auto absolute bottom-3 left-3 right-3 z-20 min-[900px]:bottom-auto min-[900px]:left-auto min-[900px]:right-3 min-[900px]:top-3 min-[900px]:w-[300px]">
          <ResultsCard
            curve={curve}
            solution={solution}
            rainfallMm={rainfallMm}
            amc={amc}
            cn={cn}
            inspector={inspector}
          />
        </div>
        {docsOpen && <TechDoc onClose={() => setDocsOpen(false)} />}
        {cropSample && (
          <SampleCropModal
            sample={cropSample.sample}
            initialWindow={cropSample.initialWindow}
            streamKm2={streamKm2}
            accumCells={accumCells}
            onStreamKm2={setStreamKm2}
            onAccumCells={setAccumCells}
            onClose={() => setCropSample(null)}
            onProcessed={(summary, sample) => {
              setCropSample(null);
              setActiveHandDem({
                kind: "sample",
                sampleId: sample.id,
                label: sample.name,
              });
              void loadSummary(summary);
            }}
          />
        )}
        {uploadOpen && (
          <UploadModal
            streamKm2={streamKm2}
            accumCells={accumCells}
            onStreamKm2={setStreamKm2}
            onAccumCells={setAccumCells}
            onClose={() => setUploadOpen(false)}
            onProcessed={(summary, source) => {
              setUploadOpen(false);
              if (source?.kind === "dem") {
                setActiveHandDem({ kind: "file", file: source.file, label: source.file.name });
              } else if (source?.kind === "hand") {
                setActiveHandDem({ kind: "hand_only", label: source.file.name });
              }
              void loadSummary(summary);
            }}
          />
        )}
      </div>

      {/* Tool 2: Standalone 3D Hydrodynamic Flow Simulation (ANUGA + Three.js) */}
      {flowSimMounted && (
        <div className={activeTool === "flow-sim" ? "h-screen w-screen" : "hidden"}>
          <FlowSimPage handSamples={samples} activeHandDem={activeHandDem} />
        </div>
      )}
    </div>
  );
}
