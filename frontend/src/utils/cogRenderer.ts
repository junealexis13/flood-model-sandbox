import { fromArrayBuffer } from "geotiff";
import type { ClickSample, HandGrid } from "../types/flood";

const MERCATOR = 20037508.342789244;

const DEPTH_STOPS: Array<[number, [number, number, number, number]]> = [
  [0, [186, 230, 214, 80]],
  [0.3, [125, 211, 192, 150]],
  [0.8, [45, 180, 176, 190]],
  [1.5, [14, 148, 168, 210]],
  [3, [3, 105, 161, 225]],
  [6, [30, 58, 138, 235]],
  [10, [49, 10, 70, 240]],
];

export function depthColor(depthM: number): [number, number, number, number] {
  const depth = Math.max(0, depthM);
  let lower = DEPTH_STOPS[0];
  let upper = DEPTH_STOPS[DEPTH_STOPS.length - 1];
  for (let i = 0; i < DEPTH_STOPS.length - 1; i += 1) {
    if (depth >= DEPTH_STOPS[i][0] && depth <= DEPTH_STOPS[i + 1][0]) {
      lower = DEPTH_STOPS[i];
      upper = DEPTH_STOPS[i + 1];
      break;
    }
  }
  if (depth >= upper[0]) return upper[1];
  const span = upper[0] - lower[0] || 1;
  const t = (depth - lower[0]) / span;
  return [
    Math.round(lower[1][0] + (upper[1][0] - lower[1][0]) * t),
    Math.round(lower[1][1] + (upper[1][1] - lower[1][1]) * t),
    Math.round(lower[1][2] + (upper[1][2] - lower[1][2]) * t),
    Math.round(lower[1][3] + (upper[1][3] - lower[1][3]) * t),
  ];
}

export function depthRampCss(): string {
  const stops = DEPTH_STOPS.map(([depth, color]) => {
    const pct = (Math.min(depth, 8) / 8) * 100;
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3] / 255}) ${pct}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export async function readHandCog(buffer: ArrayBuffer): Promise<HandGrid> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const bbox = image.getBoundingBox() as [number, number, number, number];
  const nodata = image.getGDALNoData();
  const width = image.getWidth();
  const height = image.getHeight();
  const rasters = await image.readRasters();
  const band = rasters[0] as ArrayLike<number>;
  const data = band instanceof Float32Array ? band : Float32Array.from(band);
  return {
    data,
    width,
    height,
    bbox3857: bbox,
    nodata: typeof nodata === "number" ? nodata : -9999,
  };
}

function isNoData(value: number, nodata: number): boolean {
  return !Number.isFinite(value) || Math.abs(value - nodata) < 1e-3 || value < -1e6;
}

export function paintFlood(canvas: HTMLCanvasElement, grid: HandGrid, stageM: number): void {
  if (canvas.width !== grid.width) canvas.width = grid.width;
  if (canvas.height !== grid.height) canvas.height = grid.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const image = context.createImageData(grid.width, grid.height);
  const pixels = image.data;
  const { data, nodata } = grid;
  for (let i = 0; i < data.length; i += 1) {
    const hand = data[i];
    if (isNoData(hand, nodata) || hand < 0 || hand > stageM) continue;
    const [red, green, blue, alpha] = depthColor(stageM - hand);
    const offset = i * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = alpha;
  }
  context.putImageData(image, 0, 0);
}

export function mercatorToLngLat(x: number, y: number): [number, number] {
  const lng = (x / MERCATOR) * 180;
  const lat = (Math.atan(Math.sinh((y / MERCATOR) * Math.PI)) * 180) / Math.PI;
  return [lng, lat];
}

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const x = (lng / 180) * MERCATOR;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * (MERCATOR / Math.PI);
  return [x, y];
}

export function gridCorners(grid: HandGrid): [[number, number], [number, number], [number, number], [number, number]] {
  const [minX, minY, maxX, maxY] = grid.bbox3857;
  const nw = mercatorToLngLat(minX, maxY);
  const ne = mercatorToLngLat(maxX, maxY);
  const se = mercatorToLngLat(maxX, minY);
  const sw = mercatorToLngLat(minX, minY);
  return [nw, ne, se, sw];
}

export function gridBounds(grid: HandGrid): [[number, number], [number, number]] {
  const corners = gridCorners(grid);
  const lngs = corners.map((corner) => corner[0]);
  const lats = corners.map((corner) => corner[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export function sampleHand(grid: HandGrid, lng: number, lat: number, stageM: number): ClickSample {
  const [x, y] = lngLatToMercator(lng, lat);
  const [minX, minY, maxX, maxY] = grid.bbox3857;
  if (x < minX || x > maxX || y < minY || y > maxY) {
    return { lng, lat, hand: null, depth: null };
  }
  const col = Math.min(grid.width - 1, Math.max(0, Math.floor(((x - minX) / (maxX - minX)) * grid.width)));
  const row = Math.min(grid.height - 1, Math.max(0, Math.floor(((maxY - y) / (maxY - minY)) * grid.height)));
  const hand = grid.data[row * grid.width + col];
  if (isNoData(hand, grid.nodata)) return { lng, lat, hand: null, depth: null };
  const flooded = hand >= 0 && hand <= stageM;
  return { lng, lat, hand, depth: flooded ? stageM - hand : null };
}
