export function formatMm(value: number): string {
  return `${value.toFixed(1)} mm`;
}

export function formatStage(value: number): string {
  return `${value.toFixed(2)} m`;
}

export function formatVolume(cubicMeters: number): string {
  const abs = Math.abs(cubicMeters);
  if (abs >= 1e6) return `${(cubicMeters / 1e6).toFixed(2)} million m³`;
  if (abs >= 1e3) return `${(cubicMeters / 1e3).toFixed(1)} thousand m³`;
  return `${cubicMeters.toFixed(0)} m³`;
}

export function formatArea(squareMeters: number): string {
  const km2 = squareMeters / 1e6;
  if (km2 >= 1) return `${km2.toFixed(2)} km²`;
  return `${(squareMeters / 1e4).toFixed(1)} ha`;
}

export function formatCells(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
