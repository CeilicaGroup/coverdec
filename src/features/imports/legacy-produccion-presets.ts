import type { ImportMapping } from "./types";

const normalizeSheetName = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Etiquetas para el mapeo cuando la fila de cabecera no es legible (PRODUCCION.xlsx). */
export const BASTIDORES_COLUMN_HINTS: Partial<Record<number, string>> = {
  7: "Tipo bastidor",
  9: "Proceso",
  10: "Horas por unidad",
};

export const BASTIDORES_LEGACY_MAPPING: ImportMapping = {
  sheetName: "BBDD",
  headerRow: 1,
  columnMap: {
    frameName: 7,
    processName: 9,
    hoursPerUnit: 10,
    frameCode: null,
  },
};

export function findLegacySheetName(sheetNames: string[]): string | null {
  const normalized = sheetNames.map((s) => ({
    original: s,
    key: normalizeSheetName(s),
  }));

  const exact = normalized.find((s) => s.key === "bbdd");
  if (exact) return exact.original;
  const partial = normalized.find((s) => s.key.includes("bbdd"));
  return partial?.original ?? null;
}

export function suggestLegacyMapping(sheetNames: string[]): ImportMapping {
  const detected = findLegacySheetName(sheetNames);
  return {
    ...BASTIDORES_LEGACY_MAPPING,
    sheetName: detected ?? BASTIDORES_LEGACY_MAPPING.sheetName,
  };
}

export function isLegacyProduccionWorkbook(sheetNames: string[]): boolean {
  return findLegacySheetName(sheetNames) != null;
}
