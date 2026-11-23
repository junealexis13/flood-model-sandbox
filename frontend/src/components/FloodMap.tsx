import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { BookOpen } from "lucide-react";
import type { ClickSample, HandGrid } from "../types/flood";
import { depthRampCss, gridBounds, gridCorners, paintFlood, sampleHand } from "../utils/cogRenderer";
import { formatStage } from "../utils/format";

interface FloodMapProps {
  grid: HandGrid | null;
  stageM: number;
  onInspect: (sample: ClickSample) => void;
  onOpenDocs: () => void;
}

type BasemapId = "hybrid" | "osm";

const GOOGLE_TILES = [0, 1, 2, 3].map(
  (host) => `https://mt${host}.google.com/vt/lyrs=y&hl=en&x={x}&y={y}&z={z}`,
);

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    "basemap-hybrid": {
      type: "raster",
      tiles: GOOGLE_TILES,
      tileSize: 256,
      maxzoom: 20,
      attribution: "Google",
    },
    "basemap-osm": {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#141816" } },
    { id: "basemap-hybrid", type: "raster", source: "basemap-hybrid" },
    { id: "basemap-osm", type: "raster", source: "basemap-osm", layout: { visibility: "none" } },
  ],
};

export function FloodMap({ grid, stageM, onInspect, onOpenDocs }: FloodMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const gridRef = useRef<HandGrid | null>(grid);
  const stageRef = useRef(stageM);
  const onInspectRef = useRef(onInspect);
  const overlayRef = useRef(1);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<BasemapId>("hybrid");
  const [overlay, setOverlay] = useState(1);

  gridRef.current = grid;
  stageRef.current = stageM;
  onInspectRef.current = onInspect;
  overlayRef.current = overlay;

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
    map.addLayer({
      id: "hand-flood",
      type: "raster",
      source: "hand-flood",
      paint: { "raster-opacity": overlayRef.current },
    });
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setLayoutProperty("basemap-hybrid", "visibility", basemap === "hybrid" ? "visible" : "none");
    map.setLayoutProperty("basemap-osm", "visibility", basemap === "osm" ? "visible" : "none");
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("hand-flood")) return;
    map.setPaintProperty("hand-flood", "raster-opacity", overlay);
  }, [overlay, ready, grid]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      <canvas id="hand-depth-canvas" ref={canvasRef} className="pointer-events-none absolute -left-[9999px] top-0" aria-hidden />
      <div className="pointer-events-none absolute bottom-[15.5rem] left-1/2 z-30 flex w-[min(680px,calc(100vw-1.5rem))] -translate-x-1/2 flex-wrap items-stretch justify-center gap-2 min-[900px]:bottom-6">
        <div className="pointer-events-auto flex h-fit self-center overflow-hidden border border-white/15 bg-[#121816]/80 text-[11px] text-stone-200 shadow-lg backdrop-blur-md">
          <button
            type="button"
            className={`px-2.5 py-2 ${basemap === "hybrid" ? "bg-white text-ink" : ""}`}
            aria-pressed={basemap === "hybrid"}
            onClick={() => setBasemap("hybrid")}
          >
            Google
          </button>
          <button
            type="button"
            className={`px-2.5 py-2 ${basemap === "osm" ? "bg-white text-ink" : ""}`}
            aria-pressed={basemap === "osm"}
            onClick={() => setBasemap("osm")}
          >
            OSM
          </button>
        </div>
        <button
          type="button"
          className="pointer-events-auto inline-flex items-center gap-1.5 self-center border border-[#e4d8c4] bg-paper/95 px-2.5 py-2 text-sm text-tide shadow-lg"
          onClick={onOpenDocs}
        >
          <BookOpen size={14} />
          Technical note
        </button>
        <div className="pointer-events-none w-[220px] border border-white/15 bg-[#121816]/80 px-3 py-2 text-white shadow-lg backdrop-blur-md">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-stone-300">Water depth</p>
          <div className="h-2 w-full" style={{ background: depthRampCss() }} />
          <div className="relative mt-1 h-3.5 font-mono text-[10px] text-stone-300">
            <span className="absolute left-0">0</span>
            <span className="absolute left-[12.5%] -translate-x-1/2">1 m</span>
            <span className="absolute left-[37.5%] -translate-x-1/2">3 m</span>
            <span className="absolute left-[75%] -translate-x-1/2 whitespace-nowrap">6 m+</span>
          </div>
        </div>
        <label className="pointer-events-auto flex w-[9.5rem] flex-col justify-center border border-white/15 bg-[#121816]/80 px-3 py-2 text-white shadow-lg backdrop-blur-md">
          <span className="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-stone-300">
            Overlay
            <span className="font-mono normal-case tracking-normal">{Math.round(overlay * 100)}%</span>
          </span>
          <input
            className="mt-1.5"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(overlay * 100)}
            aria-label="Flood overlay opacity"
            aria-valuetext={`${Math.round(overlay * 100)} percent opaque`}
            onChange={(event) => setOverlay(Number(event.target.value) / 100)}
          />
        </label>
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
