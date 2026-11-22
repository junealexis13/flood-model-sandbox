import { useEffect, useMemo, useRef, useState } from "react";
import { ControlPanel } from "./components/ControlPanel";
import { FloodMap } from "./components/FloodMap";
import { UploadModal } from "./components/UploadModal";
import type { Amc, ClickSample, DatasetSummary, HandGrid, HypsometricCurve } from "./types/flood";
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
  const request = useRef(0);

  const solution = useMemo(
    () => (curve ? solveStage(curve, rainfallMm, cn) : null),
    [curve, rainfallMm, cn],
  );

  useEffect(() => {
    void loadSample();
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

  async function loadSample() {
    setError(null);
    setStatus("Loading the sample basin…");
    try {
      const response = await fetch(apiUrl("/api/datasets/sample"), { method: "POST" });
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
      <FloodMap grid={grid} stageM={solution?.hM ?? 0} onInspect={setInspector} />
      <div className="pointer-events-none absolute inset-0 p-4">
        <ControlPanel
          curve={curve}
          solution={solution}
          rainfallMm={rainfallMm}
          coverId={coverId}
          amc={amc}
          cn={cn}
          streamKm2={streamKm2}
          accumCells={accumCells}
          status={status}
          error={error}
          inspector={inspector}
          onRainfall={setRainfallMm}
          onCover={chooseCover}
          onAmc={chooseAmc}
          onCn={setCn}
          onStreamKm2={setStreamKm2}
          onAccumCells={setAccumCells}
          onLoadSample={() => void loadSample()}
          onUpload={() => setUploadOpen(true)}
        />
      </div>
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
