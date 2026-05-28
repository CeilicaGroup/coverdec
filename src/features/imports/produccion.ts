import ExcelJS from "exceljs";
import { z } from "zod";
import { childLogger } from "@/lib/logger";
import { applyBastidorRows } from "./apply-bastidores";
import { buildPreviewFromSession } from "./build-preview";
import { BASTIDORES_LEGACY_MAPPING } from "./legacy-produccion-presets";
import { createImportSession } from "./session-store";
import type { ImportSummary } from "./types";
import { readFile } from "node:fs/promises";

const log = childLogger({ module: "import.produccion" });

export type { ImportSummary } from "./types";

const argsSchema = z.object({
  filePath: z.string().min(1),
});

const emptySummary = (): ImportSummary => ({
  bastidores: { created: 0, updated: 0, skipped: 0 },
  processesCreated: 0,
});

export async function importProduccion(args: {
  filePath: string;
}): Promise<ImportSummary> {
  const { filePath } = argsSchema.parse(args);
  log.info({ filePath }, "produccion import start");
  const summary = emptySummary();

  const buffer = await readFile(filePath);
  const sessionId = createImportSession(buffer);

  const bastPreview = await buildPreviewFromSession(
    sessionId,
    BASTIDORES_LEGACY_MAPPING,
  );
  const bastResult = await applyBastidorRows(
    bastPreview.rows as import("./types").BastidorRowDraft[],
  );
  summary.bastidores.created = bastResult.created;
  summary.bastidores.updated = bastResult.updated;
  summary.bastidores.skipped = bastResult.skipped;
  summary.processesCreated = bastResult.processesCreated;

  log.info({ summary }, "produccion import done");
  return summary;
}

/** @deprecated internal — kept for type re-exports only */
export type _ExcelWorkbook = ExcelJS.Workbook;
