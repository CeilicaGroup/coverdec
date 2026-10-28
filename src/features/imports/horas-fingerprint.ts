import { createHash } from "node:crypto";
import { normalizeImportLabel } from "./match-legacy-entities";
import type { ImportDb } from "./transaction";
import type { HorasRowDraft } from "./types";
import { LEGACY_HORAS_IMPORT_NOTE_PREFIX } from "./types";

/** Prefijo común de las marcas de importación de horas (formato antiguo y nuevo). */
export const HORAS_IMPORT_NOTE_PREFIX = "legacy-import:horas:";
/** Marca actual: depende del contenido de la fila, no de su posición en la hoja. */
export const HORAS_CONTENT_NOTE_PREFIX = "legacy-import:horas:v2:";

type FingerprintRow = Pick<
  HorasRowDraft,
  | "rowIndex"
  | "workDate"
  | "operatorName"
  | "projectName"
  | "lampName"
  | "processName"
  | "processCode"
  | "normalHours"
  | "extraHours"
  | "startTimeMinutes"
  | "endTimeMinutes"
>;

const num = (value: number | null) => (value == null ? "" : String(Math.round(value * 1000) / 1000));

/** Lo que identifica un parte de horas: quién, cuándo, en qué y cuánto (no área ni observaciones). */
function contentKey(row: FingerprintRow): string {
  return [
    row.workDate ? row.workDate.toISOString().slice(0, 10) : "",
    normalizeImportLabel(row.operatorName),
    normalizeImportLabel(row.projectName),
    normalizeImportLabel(row.lampName),
    row.processCode ?? normalizeImportLabel(row.processName),
    num(row.normalHours),
    num(row.extraHours),
    num(row.startTimeMinutes),
    num(row.endTimeMinutes),
  ].join("|");
}

/**
 * Marca de contenido por fila. Dos filas idénticas en la hoja son dos partes reales (p. ej. mañana
 * y tarde en la misma tarea): se distinguen por su número de aparición (#1, #2…), que no depende
 * del orden de las filas.
 */
export function horasContentFingerprints(rows: FingerprintRow[]): Map<number, string> {
  const seen = new Map<string, number>();
  const result = new Map<number, string>();
  for (const row of [...rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const key = contentKey(row);
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
    result.set(row.rowIndex, `${HORAS_CONTENT_NOTE_PREFIX}${hash}#${occurrence}`);
  }
  return result;
}

export interface ImportedHorasIndex {
  contentMarkers: Set<string>;
  /**
   * Entradas con la marca antigua `legacy-import:horas:row:N` (datos ya en producción), contadas
   * por operario + día + tarea + horas. No se usa N: esa marca no sobrevive a reordenar la hoja.
   */
  legacyCounts: Map<string, number>;
}

function markerOf(notes: string | null): string | null {
  if (!notes) return null;
  return notes.split(" | ")[0]?.trim() || null;
}

function legacyKey(e: { userId: string; taskId: string | null; day: string; hours: number }): string {
  return [e.userId, e.day, e.taskId ?? "", Math.round(e.hours * 1000)].join("|");
}

export async function loadImportedHorasIndex(db: ImportDb): Promise<ImportedHorasIndex> {
  const entries = await db.timeEntry.findMany({
    where: { notes: { startsWith: HORAS_IMPORT_NOTE_PREFIX } },
    select: { notes: true, userId: true, taskId: true, startedAt: true, hours: true },
  });
  const index: ImportedHorasIndex = { contentMarkers: new Set(), legacyCounts: new Map() };
  for (const entry of entries) {
    const marker = markerOf(entry.notes);
    if (!marker) continue;
    if (marker.startsWith(HORAS_CONTENT_NOTE_PREFIX)) {
      index.contentMarkers.add(marker);
    } else if (marker.startsWith(LEGACY_HORAS_IMPORT_NOTE_PREFIX) && entry.hours != null) {
      const key = legacyKey({
        userId: entry.userId,
        taskId: entry.taskId,
        day: entry.startedAt.toISOString().slice(0, 10),
        hours: entry.hours,
      });
      index.legacyCounts.set(key, (index.legacyCounts.get(key) ?? 0) + 1);
    }
  }
  return index;
}

/**
 * Comprobador de «ya importada», a recorrer en orden de hoja. Una fila está importada si existe
 * su marca de contenido, o si queda una entrada antigua sin asignar del mismo operario, día,
 * tarea y horas (cada entrada antigua cubre una sola fila: dos partes iguales y una sola
 * entrada antigua → el segundo parte es nuevo).
 */
export function createAlreadyImportedChecker(index: ImportedHorasIndex) {
  const remaining = new Map(index.legacyCounts);
  return (
    row: Pick<HorasRowDraft, "userId" | "taskId" | "workDate" | "totalHours">,
    fingerprint: string,
  ): boolean => {
    if (index.contentMarkers.has(fingerprint)) return true;
    if (!row.userId || !row.workDate || row.totalHours == null) return false;
    const key = legacyKey({
      userId: row.userId,
      taskId: row.taskId,
      day: row.workDate.toISOString().slice(0, 10),
      hours: row.totalHours,
    });
    const left = remaining.get(key) ?? 0;
    if (left <= 0) return false;
    remaining.set(key, left - 1);
    return true;
  };
}
