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

export async function buildPreviewFromSession(
  sessionId: string,
  mapping: ImportMapping,
  kind: ImportKind = "bastidores",
) {
  const buffer = getImportSessionBuffer(sessionId);
  if (!buffer) {
    throw new Error("SESSION_EXPIRED");
  }
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, mapping.sheetName);
  if (!sheet) {
    throw new Error(`Hoja no encontrada: ${mapping.sheetName}`);
  }
  const rawRows = extractMappedRows(sheet, mapping);

  if (kind === "proyectos") {
    const parsed = parseProyectoRows(rawRows);
    return enrichProyectoPreview(parsed);
  }
  if (kind === "horas") {
    const parsed = parseHorasRows(rawRows);
    return enrichHorasPreview(parsed);
  }

  const parsed = parseBastidorRows(rawRows);
  return enrichBastidorPreview(parsed);
}
