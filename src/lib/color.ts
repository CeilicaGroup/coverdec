const PROCESS_IMPORT_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#ca8a04",
  "#9333ea",
  "#0891b2",
  "#ea580c",
  "#be185d",
  "#4f46e5",
  "#0d9488",
] as const;

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Stable pseudo-random colors per process code (used on import create). */
export function processColorsForCode(code: string): {
  fgColor: string;
  bgColor: string;
  borderColor: string;
} {
  const fgColor =
    PROCESS_IMPORT_PALETTE[hashString(code) % PROCESS_IMPORT_PALETTE.length];
  return deriveProcessColors(fgColor);
}

export function deriveProcessColors(hex: string): {
  fgColor: string;
  bgColor: string;
  borderColor: string;
} {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number, w: number) => Math.round(c + (255 - c) * w);
  const h = (v: number) => v.toString(16).padStart(2, "0");
  return {
    fgColor: hex,
    bgColor: `#${h(mix(r, 0.88))}${h(mix(g, 0.88))}${h(mix(b, 0.88))}`,
    borderColor: `#${h(mix(r, 0.55))}${h(mix(g, 0.55))}${h(mix(b, 0.55))}`,
  };
}
