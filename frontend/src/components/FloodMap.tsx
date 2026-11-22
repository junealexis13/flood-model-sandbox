import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { ClickSample, HandGrid } from "../types/flood";
import { depthRampCss, gridBounds, gridCorners, paintFlood, sampleHand } from "../utils/cogRenderer";
import { formatStage } from "../utils/format";

interface FloodMapProps {
  grid: HandGrid | null;
  stageM: number;
  onInspect: (sample: ClickSample) => void;
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#141816" } },
    { id: "imagery", type: "raster", source: "imagery" },
  ],
};

export function FloodMap({ grid, stageM, onInspect }: FloodMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const gridRef = useRef<HandGrid | null>(grid);
  const stageRef = useRef(stageM);
  const onInspectRef = useRef(onInspect);
  const [ready, setReady] = useState(false);

  gridRef.current = grid;
  stageRef.current = stageM;
  onInspectRef.current = onInspect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: STYLE,
      center: [121.069, 15.175],
      zoom: 13,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    map.on("load", () => setReady(true));
    map.on("click", (event) => {
      const current = gridRef.current;
      if (!current) return;
      const sample = sampleHand(current, event.lngLat.lng, event.lngLat.lat, stageRef.current);
      onInspectRef.current(sample);
      popupRef.current?.remove();
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: "240px" })
        .setLngLat(event.lngLat)
        .setDOMContent(popupNode(sample))
        .addTo(map);
      popupRef.current = popup;
    });
    mapRef.current = map;
    return () => {
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    if (!map || !ready || !grid || !canvas) return;
    paintFlood(canvas, grid, stageRef.current);
    if (map.getLayer("hand-flood")) map.removeLayer("hand-flood");
    if (map.getSource("hand-flood")) map.removeSource("hand-flood");
    map.addSource("hand-flood", {
      type: "canvas",
      canvas,
      coordinates: gridCorners(grid),
      animate: true,
    });
    map.addLayer({ id: "hand-flood", type: "raster", source: "hand-flood" });
    const wide = window.innerWidth >= 900;
    map.fitBounds(gridBounds(grid), {
      padding: wide
        ? { left: 316, right: 340, top: 28, bottom: 120 }
        : { left: 16, right: 16, top: 16, bottom: 220 },
      duration: 700,
      maxZoom: 16,
    });
  }, [grid, ready]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    const frame = requestAnimationFrame(() => paintFlood(canvas, grid, stageM));
    return () => cancelAnimationFrame(frame);
  }, [grid, stageM]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <canvas id="hand-depth-canvas" ref={canvasRef} className="pointer-events-none absolute -left-[9999px] top-0" aria-hidden />
      <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 hidden w-[240px] -translate-x-1/2 min-[900px]:block">
        <div className="border border-white/15 bg-[#121816]/80 px-3 py-2 text-white shadow-lg backdrop-blur-md">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-300">Water depth</p>
          <div className="h-2 w-full" style={{ background: depthRampCss() }} />
          <div className="relative mt-1 h-3.5 font-mono text-[10px] text-stone-300">
            <span className="absolute left-0">0</span>
            <span className="absolute left-[12.5%] -translate-x-1/2">1 m</span>
            <span className="absolute left-[37.5%] -translate-x-1/2">3 m</span>
            <span className="absolute left-[75%] -translate-x-1/2 whitespace-nowrap">6 m+</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function popupNode(sample: ClickSample): HTMLElement {
  const root = document.createElement("div");
  const title = document.createElement("p");
  title.style.margin = "0";
  title.style.fontFamily = "Fraunces, Georgia, serif";
  title.style.fontSize = "18px";
  if (sample.hand === null) {
    title.textContent = "Outside the basin";
    const where = document.createElement("p");
    where.style.margin = "4px 0 0";
    where.style.fontFamily = "IBM Plex Mono, monospace";
    where.style.fontSize = "12px";
    where.textContent = `${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}`;
    root.append(title, where);
    return root;
  }
  title.textContent = sample.depth === null ? "Above this stage" : `${sample.depth.toFixed(2)} m deep`;
  const detail = document.createElement("p");
  detail.style.margin = "4px 0 0";
  detail.style.fontFamily = "IBM Plex Mono, monospace";
  detail.style.fontSize = "12px";
  detail.textContent = `HAND ${formatStage(sample.hand)} · ${sample.lat.toFixed(5)}, ${sample.lng.toFixed(5)}`;
  root.append(title, detail);
  return root;
}
