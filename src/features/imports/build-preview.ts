import { prisma } from "@/lib/db";
import type { ImportDb } from "./transaction";
import type { ImportKind, ImportMapping } from "./types";
import {
  extractMappedRows,
  getWorksheet,
  loadWorkbookFromBuffer,
} from "./excel-workbook";
import { parseBastidorRows } from "./parse-bastidores";
import { parseProyectoRows } from "./parse-proyectos";
import { parseHorasRows } from "./parse-horas";
import { enrichBastidorPreview } from "./validate";
import { enrichProyectoPreview } from "./validate-proyectos";
import { enrichHorasPreview } from "./validate-horas";
import { getImportSessionBuffer } from "./session-store";

export const IMPORT_SESSION_EXPIRED_MESSAGE =
  "La sesión de importación ha caducado (30 min). Vuelve a subir el archivo.";

export async function buildPreviewFromSession(
  sessionId: string,
  mapping: ImportMapping,
  kind: ImportKind = "bastidores",
  db: ImportDb = prisma,
) {
  const buffer = getImportSessionBuffer(sessionId);
  if (!buffer) {
    throw new Error(IMPORT_SESSION_EXPIRED_MESSAGE);
  }
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, mapping.sheetName);
  if (!sheet) {
    throw new Error(`Hoja no encontrada: ${mapping.sheetName}`);
  }
  const rawRows = extractMappedRows(sheet, mapping);

  if (kind === "proyectos") {
    const parsed = parseProyectoRows(rawRows);
    return enrichProyectoPreview(parsed, db);
  }
  if (kind === "horas") {
    const parsed = parseHorasRows(rawRows);
    return enrichHorasPreview(parsed, db);
  }

  const parsed = parseBastidorRows(rawRows);
  return enrichBastidorPreview(parsed, db);
}
