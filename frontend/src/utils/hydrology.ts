import type { Amc, CoverPreset, HypsometricCurve, StageSolution } from "../types/flood";

/** TR-55 curve numbers for hydrologic soil group B. See docs/methods.md. */
export const COVERS: CoverPreset[] = [
  { id: "woods", label: "Woods", cn2: 55, note: "Good cover, soil group B" },
  { id: "pasture", label: "Pasture", cn2: 69, note: "Fair condition, soil group B" },
  { id: "crops", label: "Row crops", cn2: 78, note: "Straight row, good, soil group B" },
  { id: "residential", label: "Residential", cn2: 85, note: "1/8 acre lots, soil group B" },
  { id: "urban", label: "Urban", cn2: 92, note: "Commercial, soil group B" },
];

export const AMC_OPTIONS: { id: Amc; label: string }[] = [
  { id: "I", label: "Dry" },
  { id: "II", label: "Average" },
  { id: "III", label: "Wet" },
];

/**
 * AMC I and III from the AMC II curve number (Chow et al., 1988).
 * Dry is AMC I. Wet is AMC III. See docs/methods.md.
 */
export function cnForAmc(cn2: number, amc: Amc): number {
  if (amc === "I") return (4.2 * cn2) / (10 - 0.058 * cn2);
  if (amc === "III") return (23 * cn2) / (10 + 0.13 * cn2);
  return cn2;
}

/** SCS runoff depth in millimetres. S = 25400/CN − 254. */
export function scsRunoffMm(rainfallMm: number, cn: number): number {
  if (!(cn > 0) || rainfallMm <= 0) return 0;
  const storage = 25400 / cn - 254;
  const initial = 0.2 * storage;
  if (rainfallMm <= initial) return 0;
  return ((rainfallMm - initial) ** 2) / (rainfallMm + 0.8 * storage);
}

export function inflowVolumeM3(runoffMm: number, basinAreaM2: number): number {
  return (runoffMm / 1000) * basinAreaM2;
}

export function solveStage(curve: HypsometricCurve, rainfallMm: number, cn: number): StageSolution {
  const qMm = scsRunoffMm(rainfallMm, cn);
  const vInM3 = inflowVolumeM3(qMm, curve.a_basin_m2);
  const stages = curve.stages_m;
  const volumes = curve.volumes_m3;
  const areas = curve.areas_m2;
  const last = stages.length - 1;
  if (last < 0) {
    return { qMm, vInM3, hM: 0, floodedAreaM2: 0, capped: false };
  }
  if (vInM3 <= volumes[0]) {
    return { qMm, vInM3, hM: stages[0], floodedAreaM2: areas[0] ?? 0, capped: false };
  }
  if (vInM3 >= volumes[last]) {
    return {
      qMm,
      vInM3,
      hM: stages[last],
      floodedAreaM2: areas[last] ?? 0,
      capped: true,
    };
  }
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (volumes[mid] <= vInM3) lo = mid;
    else hi = mid;
  }
  const span = volumes[hi] - volumes[lo];
  const fraction = span <= 0 ? 0 : (vInM3 - volumes[lo]) / span;
  return {
    qMm,
    vInM3,
    hM: stages[lo] + fraction * (stages[hi] - stages[lo]),
    floodedAreaM2: (areas[lo] ?? 0) + fraction * ((areas[hi] ?? 0) - (areas[lo] ?? 0)),
    capped: false,
  };
}
