import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SceneWindow } from "../types/flood";

const MAX_SCENE = 512;

interface CropSelectorProps {
  previewUrl: string;
  rasterWidth: number;
  rasterHeight: number;
  value: SceneWindow;
  onChange: (window: SceneWindow) => void;
}

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw" | "move" | "draw";

export function clampWindow(input: SceneWindow, rasterWidth: number, rasterHeight: number): SceneWindow {
  const minW = Math.min(16, rasterWidth);
  const minH = Math.min(16, rasterHeight);
  const width = Math.max(minW, Math.min(Math.round(input.width), MAX_SCENE, rasterWidth));
  const height = Math.max(minH, Math.min(Math.round(input.height), MAX_SCENE, rasterHeight));
  const col = Math.max(0, Math.min(Math.round(input.col), rasterWidth - width));
  const row = Math.max(0, Math.min(Math.round(input.row), rasterHeight - height));
  return { col, row, width, height };
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

export function CropSelector({ previewUrl, rasterWidth, rasterHeight, value, onChange }: CropSelectorProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: Edge; originX: number; originY: number; start: SceneWindow } | null>(null);
  const [cursor, setCursor] = useState("crosshair");

  function sourcePoint(event: ReactPointerEvent) {
    const rect = frameRef.current!.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * rasterWidth;
    const y = ((event.clientY - rect.top) / rect.height) * rasterHeight;
    return {
      x: Math.max(0, Math.min(rasterWidth, x)),
      y: Math.max(0, Math.min(rasterHeight, y)),
      margin: Math.max(4, (14 / rect.width) * rasterWidth),
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
      col = Math.min(pointX, start.col + start.width - minW);
      width = start.col + start.width - col;
    }
    if (mode === "n" || mode === "ne" || mode === "nw") {
      row = Math.min(pointY, start.row + start.height - minH);
      height = start.row + start.height - row;
    }
    if (mode === "s" || mode === "se" || mode === "sw") {
      height = pointY - start.row;
    }
    if (mode === "e" || mode === "ne" || mode === "se") {
      width = pointX - start.col;
    }
    onChange(clampWindow({ col, row, width, height }, rasterWidth, rasterHeight));
  }

  return (
    <div>
      <div
        ref={frameRef}
        className="relative w-full touch-none select-none"
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
            const x0 = Math.min(originX, point.x);
            const y0 = Math.min(originY, point.y);
            let x1 = Math.max(originX, point.x);
            let y1 = Math.max(originY, point.y);
            if (x1 - x0 > MAX_SCENE) x1 = x0 + MAX_SCENE;
            if (y1 - y0 > MAX_SCENE) y1 = y0 + MAX_SCENE;
            onChange(clampWindow({ col: x0, row: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }, rasterWidth, rasterHeight));
            return;
          }
          applyResize(mode, point.x, point.y, start);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        <img src={previewUrl} alt="Raster preview for choosing the computed window" draggable={false} className="block w-full" />
        <div
          className="pointer-events-none absolute border-2 border-tide bg-tide/25 shadow-[0_0_0_9999px_rgba(18,22,20,0.5)]"
          style={{
            left: `${(value.col / rasterWidth) * 100}%`,
            top: `${(value.row / rasterHeight) * 100}%`,
            width: `${(value.width / rasterWidth) * 100}%`,
            height: `${(value.height / rasterHeight) * 100}%`,
          }}
        >
          <span className="absolute left-1 top-1 bg-tide px-1.5 py-0.5 font-mono text-[10px] text-white">
            {value.width}×{value.height}
          </span>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {(
          [
            ["Column", value.col, "col"],
            ["Row", value.row, "row"],
            ["Width", value.width, "width"],
            ["Height", value.height, "height"],
          ] as const
        ).map(([label, current, key]) => (
          <label key={key} className="text-[10px] uppercase tracking-wide text-stone-500">
            {label}
            <input
              type="number"
              value={current}
              min={0}
              max={key === "width" || key === "height" ? MAX_SCENE : undefined}
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
        Drag the box, or draw a new one. The window stays inside the raster and at most {MAX_SCENE}×{MAX_SCENE} pixels.
        Every pixel in the window is computed.
      </p>
    </div>
  );
}
