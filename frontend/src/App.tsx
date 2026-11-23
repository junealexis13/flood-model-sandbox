import { useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { FloodMap } from "./components/FloodMap";
import { ResultsCard } from "./components/ResultsCard";
import { TechDoc } from "./components/TechDoc";
import { UploadModal } from "./components/UploadModal";
import type { Amc, ClickSample, DatasetSummary, HandGrid, HypsometricCurve, SampleChoice } from "./types/flood";
import { apiUrl, readError } from "./api/client";
import { readHandCog } from "./utils/cogRenderer";
import { COVERS, cnForAmc, solveStage } from "./utils/hydrology";

export default function App() {
  const [curve, setCurve] = useState<HypsometricCurve | null>(null);
  const [grid, setGrid] = useState<HandGrid | null>(null);
  const [rainfallMm, setRainfallMm] = useState(100);
  const [coverId, setCoverId] = useState("crops");
  const [amc, setAmc] = useState<Amc>("II");
  const [cn, setCn] = useState(78);
  const [streamKm2, setStreamKm2] = useState(1);
  const [accumCells, setAccumCells] = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
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
      const initial = list.find((item) => item.id === "sample") ?? list[0];
      if (!initial) {
        setStatus(null);
        setError("No sample DEMs were found.");
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
      if (!response.ok) throw new Error(await readError(response));
      await loadSummary((await response.json()) as DatasetSummary);
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
      <FloodMap grid={grid} stageM={solution?.hM ?? 0} onInspect={setInspector} onOpenDocs={() => setDocsOpen(true)} />
      <div className="pointer-events-auto absolute left-3 top-3 z-20 w-[min(280px,calc(100vw-1.5rem))]">
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
            void loadSample(id, choice?.name);
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
      {uploadOpen && (
        <UploadModal
          streamKm2={streamKm2}
          accumCells={accumCells}
          onStreamKm2={setStreamKm2}
          onAccumCells={setAccumCells}
          onClose={() => setUploadOpen(false)}
          onProcessed={(summary) => {
            setUploadOpen(false);
            void loadSummary(summary);
          }}
        />
      )}
    </div>
  );
}
