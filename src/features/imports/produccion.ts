import { z } from "zod";
import { childLogger } from "@/lib/logger";
import { applyBastidorRows } from "./apply-bastidores";
import { applyProyectoRows } from "./apply-proyectos";
import { applyHorasRows } from "./apply-horas";
import { buildPreviewFromSession } from "./build-preview";
import { createImportSession } from "./session-store";
import {
  suggestMappingForKind,
} from "./legacy-produccion-presets";
import type {
  BastidorRowDraft,
  HorasRowDraft,
  ImportSummary,
  ProyectoRowDraft,
} from "./types";
import { readFile } from "node:fs/promises";
import {
  getWorksheet,
  listSheetNames,
  loadWorkbookFromBuffer,
} from "./excel-workbook";

const log = childLogger({ module: "import.produccion" });

export type { ImportSummary } from "./types";

const argsSchema = z.object({
  filePath: z.string().min(1),
});

const emptySummary = (): ImportSummary => ({
  bastidores: { created: 0, updated: 0, skipped: 0 },
  processesCreated: 0,
  proyectos: {
    projectsCreated: 0,
    projectsUpdated: 0,
    projectsArchived: 0,
    lampsCreated: 0,
    lampsUpdated: 0,
    tasksCreated: 0,
    tasksUpdated: 0,
    skipped: 0,
  },
  horas: { created: 0, skipped: 0, warnings: 0 },
});

export async function importProduccion(args: {
  filePath: string;
}): Promise<ImportSummary> {
  const { filePath } = argsSchema.parse(args);
  log.info({ filePath }, "produccion import start");
  const summary = emptySummary();

  const buffer = await readFile(filePath);
  const sessionId = createImportSession(buffer);
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheetNames = listSheetNames(wb);

  const bastMapping = suggestMappingForKind(sheetNames, "bastidores");
  const bastSheet = getWorksheet(wb, bastMapping.sheetName);
  if (bastSheet) {
    const bastPreview = await buildPreviewFromSession(sessionId, bastMapping, "bastidores");
    const bastResult = await applyBastidorRows(
      bastPreview.rows as BastidorRowDraft[],
    );
    summary.bastidores.created = bastResult.created;
    summary.bastidores.updated = bastResult.updated;
    summary.bastidores.skipped = bastResult.skipped;
    summary.processesCreated = bastResult.processesCreated;
  }

  const proyMapping = suggestMappingForKind(sheetNames, "proyectos");
  const proySheet = getWorksheet(wb, proyMapping.sheetName);
  if (proySheet) {
    const proyPreview = await buildPreviewFromSession(sessionId, proyMapping, "proyectos");
    const proyResult = await applyProyectoRows(
      proyPreview.rows as ProyectoRowDraft[],
    );
    summary.proyectos = proyResult;
  }

  const horasMapping = suggestMappingForKind(sheetNames, "horas");
  const horasSheet = getWorksheet(wb, horasMapping.sheetName);
  if (horasSheet) {
    const horasPreview = await buildPreviewFromSession(sessionId, horasMapping, "horas");
    const horasResult = await applyHorasRows(horasPreview.rows as HorasRowDraft[]);
    summary.horas = horasResult;
  }

  log.info({ summary }, "produccion import done");
  return summary;
}

/** @deprecated internal — kept for type re-exports only */
export type _ExcelWorkbook = import("exceljs").Workbook;
