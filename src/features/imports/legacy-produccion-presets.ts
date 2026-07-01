import type { ImportKind, ImportMapping } from "./types";

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

export const PROYECTOS_COLUMN_HINTS: Partial<Record<number, string>> = {
  1: "Proyecto",
  2: "Lampara",
  3: "Tipo_bastidor",
  4: "Medida",
  5: "Fecha_de_entrega",
  6: "Área",
  7: "Proceso",
  8: "Hr_plan",
  16: "Estado",
  17: "Estado_proyecto",
};

export const HORAS_COLUMN_HINTS: Partial<Record<number, string>> = {
  2: "Fecha",
  3: "Operario",
  4: "Proyecto",
  5: "Lámpara",
  6: "Área",
  7: "Proceso",
  8: "Hora Inicio",
  9: "Hora Fin",
  10: "Horas Normales",
  11: "Horas Extras",
  12: "Observaciones",
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

export const PROYECTOS_LEGACY_MAPPING: ImportMapping = {
  sheetName: "🗂️ Proyectos",
  headerRow: 1,
  columnMap: {
    projectName: 1,
    lampName: 2,
    frameTypeName: 3,
    surfaceM2: 4,
    deliveryDate: 5,
    areaName: 6,
    processName: 7,
    hrPlan: 8,
    hrTotal: 9,
    hrNormal: 10,
    hrExtra: 11,
    hrPending: 13,
    taskStatus: 16,
    projectStatus: 17,
  },
};

export const HORAS_LEGACY_MAPPING: ImportMapping = {
  sheetName: "👷horas",
  headerRow: 1,
  columnMap: {
    workDate: 2,
    operatorName: 3,
    projectName: 4,
    lampName: 5,
    areaName: 6,
    processName: 7,
    startTime: 8,
    endTime: 9,
    normalHours: 10,
    extraHours: 11,
    notes: 12,
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

export function findProyectosSheetName(sheetNames: string[]): string | null {
  const normalized = sheetNames.map((s) => ({
    original: s,
    key: normalizeSheetName(s),
  }));
  const exact = normalized.find((s) => s.key === "proyectos");
  if (exact) return exact.original;
  const partial = normalized.find((s) => s.key.includes("proyectos"));
  return partial?.original ?? null;
}

export function findHorasSheetName(sheetNames: string[]): string | null {
  const normalized = sheetNames.map((s) => ({
    original: s,
    key: normalizeSheetName(s),
  }));
  const exact = normalized.find((s) => s.key === "horas");
  if (exact) return exact.original;
  const partial = normalized.find((s) => s.key.includes("horas"));
  return partial?.original ?? null;
}

export function suggestLegacyMapping(sheetNames: string[]): ImportMapping {
  const detected = findLegacySheetName(sheetNames);
  return {
    ...BASTIDORES_LEGACY_MAPPING,
    sheetName: detected ?? BASTIDORES_LEGACY_MAPPING.sheetName,
  };
}

export function suggestMappingForKind(
  sheetNames: string[],
  kind: ImportKind,
): ImportMapping {
  if (kind === "proyectos") {
    const detected = findProyectosSheetName(sheetNames);
    return {
      ...PROYECTOS_LEGACY_MAPPING,
      sheetName: detected ?? PROYECTOS_LEGACY_MAPPING.sheetName,
    };
  }
  if (kind === "horas") {
    const detected = findHorasSheetName(sheetNames);
    return {
      ...HORAS_LEGACY_MAPPING,
      sheetName: detected ?? HORAS_LEGACY_MAPPING.sheetName,
    };
  }
  if (kind === "produccion_completa") {
    return suggestMappingForKind(sheetNames, "bastidores");
  }
  return suggestLegacyMapping(sheetNames);
}

export function columnHintsForKind(kind: ImportKind): Partial<Record<number, string>> {
  if (kind === "proyectos") return PROYECTOS_COLUMN_HINTS;
  if (kind === "horas") return HORAS_COLUMN_HINTS;
  if (kind === "produccion_completa") return BASTIDORES_COLUMN_HINTS;
  return BASTIDORES_COLUMN_HINTS;
}

export function isLegacyProduccionWorkbook(sheetNames: string[]): boolean {
  return findLegacySheetName(sheetNames) != null;
}

export function detectAvailableImportKinds(sheetNames: string[]): ImportKind[] {
  const kinds: ImportKind[] = [];
  if (findLegacySheetName(sheetNames)) kinds.push("bastidores");
  if (findProyectosSheetName(sheetNames)) kinds.push("proyectos");
  if (findHorasSheetName(sheetNames)) kinds.push("horas");
  if (kinds.length >= 2) kinds.push("produccion_completa");
  return kinds;
}
