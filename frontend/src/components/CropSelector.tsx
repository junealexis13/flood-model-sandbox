import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SceneWindow } from "../types/flood";

export const MAX_SCENE = 2048;

interface CropSelectorProps {
  previewUrl: string;
  rasterWidth: number;
  rasterHeight: number;
  dxM?: number;
  dyM?: number;
  value: SceneWindow;
  onChange: (window: SceneWindow) => void;
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move" | "draw";

export function maxFitWindow(rasterWidth: number, rasterHeight: number): SceneWindow {
  const width = Math.min(rasterWidth, MAX_SCENE);
  const height = Math.min(rasterHeight, MAX_SCENE);
  return {
    col: Math.max(0, Math.floor((rasterWidth - width) / 2)),
    row: Math.max(0, Math.floor((rasterHeight - height) / 2)),
    width,
    height,
  };
}

export function clampWindow(input: SceneWindow, rasterWidth: number, rasterHeight: number): SceneWindow {
  const minW = Math.min(16, rasterWidth);
  const minH = Math.min(16, rasterHeight);
  const width = Math.max(minW, Math.min(Math.round(input.width), MAX_SCENE, rasterWidth));
  const height = Math.max(minH, Math.min(Math.round(input.height), MAX_SCENE, rasterHeight));
  const col = Math.max(0, Math.min(Math.round(input.col), rasterWidth - width));
  const row = Math.max(0, Math.min(Math.round(input.row), rasterHeight - height));
  return { col, row, width, height };
}

export function cropAxisSummary(rasterWidth: number, rasterHeight: number): string {
  const overW = rasterWidth > MAX_SCENE;
  const overH = rasterHeight > MAX_SCENE;
  if (overW && overH) {
    return `Both width (${rasterWidth} px) and height (${rasterHeight} px) exceed ${MAX_SCENE} px. Drag, resize, or draw an AOI up to ${MAX_SCENE}×${MAX_SCENE} px.`;
  }
  if (overW) {
    return `Width (${rasterWidth} px) exceeds ${MAX_SCENE} px while height (${rasterHeight} px) fits in full. Slide or resize the AOI window below.`;
  }
  if (overH) {
    return `Height (${rasterHeight} px) exceeds ${MAX_SCENE} px while width (${rasterWidth} px) fits in full. Slide or resize the AOI window below.`;
  }
  return `Within the ${MAX_SCENE}×${MAX_SCENE} px limit, so the full raster can be computed.`;
}

function hitTest(x: number, y: number, win: SceneWindow, margin: number): Edge {
  const left = win.col;
  const right = win.col + win.width;
  const top = win.row;
  const bottom = win.row + win.height;
  const nearL = Math.abs(x - left) <= margin;
  const nearR = Math.abs(x - right) <= margin;
  const nearT = Math.abs(y - top) <= margin;
  const nearB = Math.abs(y - bottom) <= margin;
  const insideX = x >= left - margin && x <= right + margin;
  const insideY = y >= top - margin && y <= bottom + margin;
  if (nearT && nearL) return "nw";
  if (nearT && nearR) return "ne";
  if (nearB && nearL) return "sw";
  if (nearB && nearR) return "se";
  if (nearT && insideX) return "n";
  if (nearB && insideX) return "s";
  if (nearL && insideY) return "w";
  if (nearR && insideY) return "e";
  if (x >= left && x <= right && y >= top && y <= bottom) return "move";
  return "draw";
}

const CURSOR: Record<Edge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
  move: "move",
  draw: "crosshair",
};

export function CropSelector({
  previewUrl,
  rasterWidth,
  rasterHeight,
  dxM,
  dyM,
  value,
  onChange,
}: CropSelectorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Edge; originX: number; originY: number; start: SceneWindow } | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  const maxW = Math.min(rasterWidth, MAX_SCENE);
  const maxH = Math.min(rasterHeight, MAX_SCENE);

  function sourcePoint(event: ReactPointerEvent) {
    const rect = frameRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * rasterWidth;
    const y = ((event.clientY - rect.top) / rect.height) * rasterHeight;
    return {
      x: Math.max(0, Math.min(rasterWidth, x)),
      y: Math.max(0, Math.min(rasterHeight, y)),
      margin: Math.max(8, (16 / rect.width) * rasterWidth),
    };
  }

  function applyResize(mode: Edge, pointX: number, pointY: number, start: SceneWindow) {
    const minW = Math.min(16, rasterWidth);
    const minH = Math.min(16, rasterHeight);
    let col = start.col;
    let row = start.row;
    let width = start.width;
    let height = start.height;

    if (mode === "w" || mode === "nw" || mode === "sw") {
      const right = start.col + start.width;
      const minCol = Math.max(0, right - MAX_SCENE);
      col = Math.max(minCol, Math.min(pointX, right - minW));
      width = right - col;
    }
    if (mode === "e" || mode === "ne" || mode === "se") {
      const limitW = Math.min(MAX_SCENE, rasterWidth - start.col);
      width = Math.max(minW, Math.min(pointX - start.col, limitW));
    }
    if (mode === "n" || mode === "ne" || mode === "nw") {
      const bottom = start.row + start.height;
      const minRow = Math.max(0, bottom - MAX_SCENE);
      row = Math.max(minRow, Math.min(pointY, bottom - minH));
      height = bottom - row;
    }
    if (mode === "s" || mode === "se" || mode === "sw") {
      const limitH = Math.min(MAX_SCENE, rasterHeight - start.row);
      height = Math.max(minH, Math.min(pointY - start.row, limitH));
    }

    onChange(clampWindow({ col, row, width, height }, rasterWidth, rasterHeight));
  }

  const groundLabel =
    dxM && dyM
      ? `${((value.width * dxM) / 1000).toFixed(2)} × ${((value.height * dyM) / 1000).toFixed(2)} km`
      : null;

  return (
    <div>
      <div className="flex justify-center border border-[#e4d8c4] bg-[#161d1a] p-1">
        <div
          ref={frameRef}
          className="relative inline-block overflow-hidden touch-none select-none"
          style={{ cursor }}
          onPointerDown={(event) => {
            const point = sourcePoint(event);
            const mode = hitTest(point.x, point.y, value, point.margin);
            drag.current = { mode, originX: point.x, originY: point.y, start: value };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const point = sourcePoint(event);
            if (!drag.current) {
              setCursor(CURSOR[hitTest(point.x, point.y, value, point.margin)]);
              return;
            }
            const { mode, originX, originY, start } = drag.current;
            if (mode === "move") {
              onChange(
                clampWindow(
                  {
                    ...start,
                    col: start.col + (point.x - originX),
                    row: start.row + (point.y - originY),
                  },
                  rasterWidth,
                  rasterHeight,
                ),
              );
              return;
            }
            if (mode === "draw") {
              const clampedX = Math.max(
                0,
                Math.min(rasterWidth, originX + Math.max(-MAX_SCENE, Math.min(MAX_SCENE, point.x - originX))),
              );
              const clampedY = Math.max(
                0,
                Math.min(rasterHeight, originY + Math.max(-MAX_SCENE, Math.min(MAX_SCENE, point.y - originY))),
              );
              const x0 = Math.min(originX, clampedX);
              const y0 = Math.min(originY, clampedY);
              const w = Math.max(1, Math.abs(clampedX - originX));
              const h = Math.max(1, Math.abs(clampedY - originY));
              onChange(clampWindow({ col: x0, row: y0, width: w, height: h }, rasterWidth, rasterHeight));
              return;
            }
            applyResize(mode, point.x, point.y, start);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        >
          <img
            src={previewUrl}
            alt="Raster preview for choosing the AOI window"
            draggable={false}
            className="block max-h-[38vh] max-w-full"
          />
          <div
            className="pointer-events-none absolute border-2 border-tide bg-tide/20 shadow-[0_0_0_9999px_rgba(18,22,20,0.58)]"
            style={{
              left: `${(value.col / rasterWidth) * 100}%`,
              top: `${(value.row / rasterHeight) * 100}%`,
              width: `${(value.width / rasterWidth) * 100}%`,
              height: `${(value.height / rasterHeight) * 100}%`,
            }}
          >
            <span className="absolute left-3 top-1.5 bg-tide/95 px-1.5 py-0.5 font-mono text-[10px] text-white shadow">
              {value.width}×{value.height} px{groundLabel ? ` · ${groundLabel}` : ""}
            </span>

            {/* Corner & edge resize handles (flush inside border so never clipped at raster edges) */}
            <span className="absolute left-0 top-0 h-2.5 w-2.5 border border-tide bg-white" />
            <span className="absolute right-0 top-0 h-2.5 w-2.5 border border-tide bg-white" />
            <span className="absolute bottom-0 left-0 h-2.5 w-2.5 border border-tide bg-white" />
            <span className="absolute bottom-0 right-0 h-2.5 w-2.5 border border-tide bg-white" />
            <span className="absolute left-1/2 top-0 h-1.5 w-5 -translate-x-1/2 border border-tide bg-white" />
            <span className="absolute bottom-0 left-1/2 h-1.5 w-5 -translate-x-1/2 border border-tide bg-white" />
            <span className="absolute left-0 top-1/2 h-5 w-1.5 -translate-y-1/2 border border-tide bg-white" />
            <span className="absolute right-0 top-1/2 h-5 w-1.5 -translate-y-1/2 border border-tide bg-white" />
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="border border-stone-300 bg-white px-2 py-1 text-[11px] text-ink hover:bg-stone-50"
            onClick={() => onChange(maxFitWindow(rasterWidth, rasterHeight))}
          >
            Max fit ({maxW}×{maxH})
          </button>
          <button
            type="button"
            className="border border-stone-300 bg-white px-2 py-1 text-[11px] text-ink hover:bg-stone-50"
            onClick={() =>
              onChange(
                clampWindow(
                  {
                    ...value,
                    col: Math.floor((rasterWidth - value.width) / 2),
                    row: Math.floor((rasterHeight - value.height) / 2),
                  },
                  rasterWidth,
                  rasterHeight,
                ),
              )
            }
          >
            Center box
          </button>
        </div>
        <span className="font-mono text-[11px] text-stone-500">
          Max {maxW}×{maxH} px
        </span>
      </div>

      <div className="mt-2 grid grid-cols-4 gap-2">
        {(
          [
            ["Column", value.col, "col", Math.max(0, rasterWidth - value.width)],
            ["Row", value.row, "row", Math.max(0, rasterHeight - value.height)],
            ["Width", value.width, "width", maxW],
            ["Height", value.height, "height", maxH],
          ] as const
        ).map(([label, current, key, maxVal]) => (
          <label key={key} className="text-[10px] uppercase tracking-wide text-stone-500">
            {label}
            <input
              type="number"
              value={current}
              min={key === "width" || key === "height" ? Math.min(16, maxVal) : 0}
              max={maxVal}
              className="mt-1 w-full border border-stone-300 bg-white px-1.5 py-1 font-mono text-xs text-ink"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (!Number.isFinite(next)) return;
                onChange(clampWindow({ ...value, [key]: next }, rasterWidth, rasterHeight));
              }}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-stone-600">
        Drag inside the box to move it, drag any handle to resize freely, or click outside to draw a new AOI (up to{" "}
        {MAX_SCENE}×{MAX_SCENE} px). Every pixel inside the box is computed at native resolution.
      </p>
    </div>
  );
}
