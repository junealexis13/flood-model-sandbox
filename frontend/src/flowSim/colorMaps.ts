export type RgbTuple = [number, number, number];

const TERRAIN_STOPS: Array<[number, RgbTuple]> = [
  [0.0, [74, 98, 72]],
  [0.2, [112, 134, 86]],
  [0.45, [168, 162, 118]],
  [0.7, [176, 136, 98]],
  [0.88, [142, 116, 98]],
  [1.0, [218, 212, 202]],
];

const DEPTH_STOPS: Array<[number, RgbTuple]> = [
  [0.0, [167, 243, 208]],
  [0.12, [94, 216, 198]],
  [0.3, [20, 184, 166]],
  [0.55, [14, 116, 144]],
  [0.8, [30, 64, 175]],
  [1.0, [49, 24, 102]],
];

const VELOCITY_STOPS: Array<[number, RgbTuple]> = [
  [0.0, [49, 130, 189]],
  [0.25, [56, 189, 174]],
  [0.5, [250, 204, 21]],
  [0.75, [249, 115, 22]],
  [1.0, [220, 38, 38]],
];

function sampleStops(stops: Array<[number, RgbTuple]>, tRaw: number): RgbTuple {
  const t = Math.max(0, Math.min(1, Number.isFinite(tRaw) ? tRaw : 0));
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const span = t1 - t0 || 1;
      const u = (t - t0) / span;
      return [
        (c0[0] + (c1[0] - c0[0]) * u) / 255,
        (c0[1] + (c1[1] - c0[1]) * u) / 255,
        (c0[2] + (c1[2] - c0[2]) * u) / 255,
      ];
    }
  }
  const last = stops[stops.length - 1][1];
  return [last[0] / 255, last[1] / 255, last[2] / 255];
}

export function terrainColorNormalized(t: number): RgbTuple {
  return sampleStops(TERRAIN_STOPS, t);
}

export function depthColorNormalized(depthM: number, maxScaleM: number): RgbTuple {
  const scale = Math.max(0.25, maxScaleM);
  return sampleStops(DEPTH_STOPS, depthM / scale);
}

export function velocityColorNormalized(speedMS: number, maxScaleMS: number): RgbTuple {
  const scale = Math.max(0.5, maxScaleMS);
  return sampleStops(VELOCITY_STOPS, speedMS / scale);
}

function stopsToCss(stops: Array<[number, RgbTuple]>): string {
  const entries = stops.map(([pos, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${Math.round(pos * 100)}%`);
  return `linear-gradient(90deg, ${entries.join(", ")})`;
}

export function flowDepthRampCss(): string {
  return stopsToCss(DEPTH_STOPS);
}

export function flowVelocityRampCss(): string {
  return stopsToCss(VELOCITY_STOPS);
}

export function terrainRampCss(): string {
  return stopsToCss(TERRAIN_STOPS);
}
