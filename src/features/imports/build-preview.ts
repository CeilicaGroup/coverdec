import type { ImportMapping } from "./types";
import {
  extractMappedRows,
  getWorksheet,
  loadWorkbookFromBuffer,
} from "./excel-workbook";
import { parseBastidorRows } from "./parse-bastidores";
import { enrichBastidorPreview } from "./validate";
import { getImportSessionBuffer } from "./session-store";

export async function buildPreviewFromSession(
  sessionId: string,
  mapping: ImportMapping,
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
  const parsed = parseBastidorRows(rawRows);
  return enrichBastidorPreview(parsed);
}
