"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { applyBastidorRows } from "./apply-bastidores";
import { buildPreviewFromSession } from "./build-preview";
import {
  buildSheetColumnOptions,
  type SheetColumnOption,
} from "./excel-columns";
import {
  extractMappedRows,
  getWorksheet,
  listSheetNames,
  loadWorkbookFromBuffer,
} from "./excel-workbook";
import {
  BASTIDORES_COLUMN_HINTS,
  suggestLegacyMapping,
} from "./legacy-produccion-presets";
import { mergeBastidorRowEdits, enrichBastidorPreview } from "./validate";
import {
  createImportSession,
  deleteImportSession,
  getImportSessionBuffer,
} from "./session-store";
import type {
  BastidorRowDraft,
  ImportApplyResult,
  ImportInspectResult,
  ImportMapping,
} from "./types";
import { countBlockingImportErrors, IMPORT_MAX_FILE_BYTES } from "./types";
import { parseBastidorRows } from "./parse-bastidores";

const log = childLogger({ module: "imports.actions" });

const columnMapSchema = z.record(z.string(), z.number().nullable());

const mappingSchema = z.object({
  sheetName: z.string().min(1),
  headerRow: z.number().int().min(1).max(100),
  columnMap: columnMapSchema,
});

const bastidorRowSchema = z.object({
  rowIndex: z.number(),
  frameName: z.string(),
  processName: z.string(),
  hoursPerUnit: z.number().nullable(),
  frameCode: z.string().nullable(),
  processCode: z.string().nullable(),
  issues: z.array(
    z.object({
      code: z.string(),
      field: z.string().optional(),
      message: z.string(),
      severity: z.enum(["error", "warning"]),
    }),
  ),
  status: z.enum(["ok", "warning", "error", "skipped"]),
  action: z.enum(["create", "update", "skip"]),
});

function requireAdmin() {
  return requireDashboardContext().then((ctx) => {
    requireRole(ctx, [Role.ADMIN]);
    return ctx;
  });
}

export async function inspectImportFile(
  formData: FormData,
): Promise<ImportInspectResult> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("No se recibió ningún archivo");
  }
  if (file.size > IMPORT_MAX_FILE_BYTES) {
    throw new Error("El archivo supera el tamaño máximo (15 MB)");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheetNames = listSheetNames(wb);
  const suggestedMapping = suggestLegacyMapping(sheetNames);
  const sheet = getWorksheet(wb, suggestedMapping.sheetName);
  const columnOptions = sheet
    ? buildSheetColumnOptions(
        sheet,
        suggestedMapping.headerRow,
        BASTIDORES_COLUMN_HINTS,
      )
    : [];
  const sampleRowCount = sheet
    ? extractMappedRows(sheet, suggestedMapping).length
    : 0;
  const sessionId = createImportSession(buffer);
  log.info({ sessionId, sheetNames: sheetNames.length }, "import file inspected");
  return {
    sessionId,
    sheetNames,
    suggestedMapping,
    columnOptions,
    sampleRowCount,
  };
}

export async function buildImportPreview(input: {
  sessionId: string;
  mapping: ImportMapping;
  rowEdits?: Array<{ rowIndex: number; patch: Record<string, unknown> }>;
}) {
  await requireAdmin();
  const mapping = mappingSchema.parse(input.mapping) as ImportMapping;

  let preview = await buildPreviewFromSession(input.sessionId, mapping);

  if (input.rowEdits?.length) {
    const merged = mergeBastidorRowEdits(
      preview.rows as BastidorRowDraft[],
      input.rowEdits as Array<{
        rowIndex: number;
        patch: Partial<BastidorRowDraft>;
      }>,
    );
    preview = await enrichBastidorPreview(merged);
  }

  return preview;
}

export async function applyImportPreview(input: {
  sessionId: string;
  rows: BastidorRowDraft[];
}): Promise<ImportApplyResult> {
  await requireAdmin();

  const blocking = countBlockingImportErrors(input.rows);
  if (blocking > 0) {
    throw new Error(
      `Hay ${blocking} fila(s) con error sin marcar como «Omitir». Corrígelas o omítelas antes de importar.`,
    );
  }

  const rows = z.array(bastidorRowSchema).parse(input.rows) as BastidorRowDraft[];
  const bastidores = await applyBastidorRows(rows);
  deleteImportSession(input.sessionId);
  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard/admin/export");
  log.info({ bastidores }, "bastidores import applied");
  return { bastidores };
}

export async function getImportCatalogOptions() {
  await requireAdmin();
  const [processes, frames] = await Promise.all([
    prisma.processDefinition.findMany({
      orderBy: { label: "asc" },
      select: { code: true, label: true },
    }),
    prisma.frameType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
  ]);
  return { processes, frames };
}

export async function getSheetColumnsForMapping(input: {
  sessionId: string;
  sheetName: string;
}): Promise<SheetColumnOption[]> {
  await requireAdmin();
  const buffer = getImportSessionBuffer(input.sessionId);
  if (!buffer) throw new Error("SESSION_EXPIRED");
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, input.sheetName);
  if (!sheet) return [];
  return buildSheetColumnOptions(sheet, 1, BASTIDORES_COLUMN_HINTS);
}

export async function parseImportRows(input: {
  sessionId: string;
  mapping: ImportMapping;
}) {
  await requireAdmin();
  const buffer = getImportSessionBuffer(input.sessionId);
  if (!buffer) throw new Error("SESSION_EXPIRED");
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, input.mapping.sheetName);
  if (!sheet) throw new Error(`Hoja no encontrada: ${input.mapping.sheetName}`);
  const raw = extractMappedRows(sheet, input.mapping);
  return parseBastidorRows(raw);
}
