"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import { applyBastidorRows } from "./apply-bastidores";
import { applyProyectoRows } from "./apply-proyectos";
import { applyHorasRows } from "./apply-horas";
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
  columnHintsForKind,
  detectAvailableImportKinds,
  suggestMappingForKind,
} from "./legacy-produccion-presets";
import { mergeBastidorRowEdits, enrichBastidorPreview } from "./validate";
import { mergeProyectoRowEdits } from "./validate-proyectos";
import { mergeHorasRowEdits } from "./validate-horas";
import {
  createImportSession,
  deleteImportSession,
  getImportSessionBuffer,
} from "./session-store";
import type {
  BastidorRowDraft,
  HorasRowDraft,
  ImportApplyResult,
  ImportInspectResult,
  ImportKind,
  ImportMapping,
  ImportAction,
  ImportRowStatus,
  ProyectoRowDraft,
} from "./types";
import { countBlockingImportErrors, IMPORT_MAX_FILE_BYTES } from "./types";
import { parseBastidorRows } from "./parse-bastidores";

const log = childLogger({ module: "imports.actions" });

const importKindSchema = z.enum([
  "bastidores",
  "proyectos",
  "horas",
  "produccion_completa",
]);

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

const proyectoRowSchema = z.object({
  rowIndex: z.number(),
  projectName: z.string(),
  lampName: z.string(),
  frameTypeName: z.string(),
  surfaceM2: z.number().nullable(),
  deliveryDate: z.coerce.date().nullable(),
  areaName: z.string(),
  processName: z.string(),
  hrPlan: z.number().nullable(),
  hrTotal: z.number().nullable(),
  hrNormal: z.number().nullable(),
  hrExtra: z.number().nullable(),
  hrPending: z.number().nullable(),
  taskStatus: z.string(),
  projectStatus: z.string(),
  processCode: z.string().nullable(),
  elementTypeId: z.string().nullable(),
  elementTypeName: z.string().nullable(),
  projectId: z.string().nullable(),
  lampId: z.string().nullable(),
  taskId: z.string().nullable(),
  isCompleted: z.boolean(),
  archiveProject: z.boolean(),
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

const horasRowSchema = z.object({
  rowIndex: z.number(),
  workDate: z.coerce.date().nullable(),
  operatorName: z.string(),
  projectName: z.string(),
  lampName: z.string(),
  areaName: z.string(),
  processName: z.string(),
  startTimeMinutes: z.number().nullable(),
  endTimeMinutes: z.number().nullable(),
  normalHours: z.number().nullable(),
  extraHours: z.number().nullable(),
  notes: z.string(),
  totalHours: z.number().nullable(),
  processCode: z.string().nullable(),
  userId: z.string().nullable(),
  operatorLabel: z.string().nullable(),
  projectId: z.string().nullable(),
  lampId: z.string().nullable(),
  taskId: z.string().nullable(),
  startedAt: z.coerce.date().nullable(),
  endedAt: z.coerce.date().nullable(),
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

function effectiveKindForPreview(kind: ImportKind): ImportKind {
  return kind === "produccion_completa" ? "bastidores" : kind;
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

  const kindRaw = formData.get("importKind");
  const importKind = importKindSchema.parse(
    typeof kindRaw === "string" ? kindRaw : "bastidores",
  );

  const buffer = Buffer.from(await file.arrayBuffer());
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheetNames = listSheetNames(wb);
  const availableKinds = detectAvailableImportKinds(sheetNames);

  const resolvedKind =
    importKind === "produccion_completa" && availableKinds.includes("produccion_completa")
      ? "produccion_completa"
      : effectiveKindForPreview(importKind);

  const mappingKind =
    resolvedKind === "produccion_completa" ? "bastidores" : resolvedKind;

  const suggestedMapping = suggestMappingForKind(sheetNames, mappingKind);
  const sheet = getWorksheet(wb, suggestedMapping.sheetName);
  const columnOptions = sheet
    ? buildSheetColumnOptions(
        sheet,
        suggestedMapping.headerRow,
        columnHintsForKind(mappingKind),
      )
    : [];
  const sampleRowCount = sheet
    ? extractMappedRows(sheet, suggestedMapping).length
    : 0;
  const sessionId = createImportSession(buffer);
  log.info(
    { sessionId, sheetNames: sheetNames.length, importKind: resolvedKind },
    "import file inspected",
  );
  return {
    sessionId,
    sheetNames,
    importKind: resolvedKind,
    availableKinds,
    suggestedMapping,
    columnOptions,
    sampleRowCount,
  };
}

export async function buildImportPreview(input: {
  sessionId: string;
  importKind: ImportKind;
  mapping: ImportMapping;
  rowEdits?: Array<{ rowIndex: number; patch: Record<string, unknown> }>;
}) {
  await requireAdmin();
  const importKind = importKindSchema.parse(input.importKind);
  const mapping = mappingSchema.parse(input.mapping) as ImportMapping;
  const kind = effectiveKindForPreview(importKind);

  let preview = await buildPreviewFromSession(input.sessionId, mapping, kind);

  if (input.rowEdits?.length) {
    if (kind === "proyectos") {
      const merged = mergeProyectoRowEdits(
        preview.rows as ProyectoRowDraft[],
        input.rowEdits as Array<{
          rowIndex: number;
          patch: Partial<ProyectoRowDraft>;
        }>,
      );
      const { enrichProyectoPreview } = await import("./validate-proyectos");
      preview = await enrichProyectoPreview(merged);
    } else if (kind === "horas") {
      const merged = mergeHorasRowEdits(
        preview.rows as HorasRowDraft[],
        input.rowEdits as Array<{
          rowIndex: number;
          patch: Partial<HorasRowDraft>;
        }>,
      );
      const { enrichHorasPreview } = await import("./validate-horas");
      preview = await enrichHorasPreview(merged);
    } else {
      const merged = mergeBastidorRowEdits(
        preview.rows as BastidorRowDraft[],
        input.rowEdits as Array<{
          rowIndex: number;
          patch: Partial<BastidorRowDraft>;
        }>,
      );
      preview = await enrichBastidorPreview(merged);
    }
  }

  return preview;
}

export async function applyImportPreview(input: {
  sessionId: string;
  importKind: ImportKind;
  rows: BastidorRowDraft[] | ProyectoRowDraft[] | HorasRowDraft[];
}): Promise<ImportApplyResult> {
  return runAuditedMutation(
    "imports.applyImportPreview",
    async () => {
      await requireAdmin();
      const importKind = importKindSchema.parse(input.importKind);

      const blocking = countBlockingImportErrors(
        input.rows as Array<{ status: ImportRowStatus; action: ImportAction }>,
      );
      if (blocking > 0) {
        throw new Error(
          `Hay ${blocking} fila(s) con error sin marcar como «Omitir». Corrígelas o omítelas antes de importar.`,
        );
      }

      if (importKind === "produccion_completa") {
        return applyProduccionCompleta(input.sessionId);
      }

      if (importKind === "proyectos") {
        const rows = z.array(proyectoRowSchema).parse(input.rows) as ProyectoRowDraft[];
        const proyectos = await applyProyectoRows(rows);
        deleteImportSession(input.sessionId);
        revalidatePath("/dashboard/proyectos");
        revalidatePath("/dashboard/admin/export");
        log.info({ proyectos }, "proyectos import applied");
        return { importKind, proyectos };
      }

      if (importKind === "horas") {
        const rows = z.array(horasRowSchema).parse(input.rows) as HorasRowDraft[];
        const horas = await applyHorasRows(rows);
        deleteImportSession(input.sessionId);
        revalidatePath("/dashboard/horas");
        revalidatePath("/dashboard/admin/export");
        log.info({ horas }, "horas import applied");
        return { importKind, horas };
      }

      const rows = z.array(bastidorRowSchema).parse(input.rows) as BastidorRowDraft[];
      const bastidores = await applyBastidorRows(rows);
      deleteImportSession(input.sessionId);
      revalidatePath("/dashboard/catalogo");
      revalidatePath("/dashboard/admin/export");
      log.info({ bastidores }, "bastidores import applied");
      return { importKind, bastidores };
    },
    (result) => ({
      summary: `Importación ${result.importKind}`,
      metadata: { sessionId: input.sessionId, importKind: result.importKind },
    }),
  );
}

async function applyProduccionCompleta(sessionId: string): Promise<ImportApplyResult> {
  const buffer = getImportSessionBuffer(sessionId);
  if (!buffer) throw new Error("SESSION_EXPIRED");

  const wb = await loadWorkbookFromBuffer(buffer);
  const sheetNames = listSheetNames(wb);

  const bastPreview = await buildPreviewFromSession(
    sessionId,
    suggestMappingForKind(sheetNames, "bastidores"),
    "bastidores",
  );
  const bastidores = await applyBastidorRows(bastPreview.rows as BastidorRowDraft[]);

  const proyPreview = await buildPreviewFromSession(
    sessionId,
    suggestMappingForKind(sheetNames, "proyectos"),
    "proyectos",
  );
  const proyectos = await applyProyectoRows(proyPreview.rows as ProyectoRowDraft[]);

  const horasPreview = await buildPreviewFromSession(
    sessionId,
    suggestMappingForKind(sheetNames, "horas"),
    "horas",
  );
  const horas = await applyHorasRows(horasPreview.rows as HorasRowDraft[]);

  deleteImportSession(sessionId);
  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/admin/export");

  log.info({ bastidores, proyectos, horas }, "produccion completa applied");

  return {
    importKind: "produccion_completa",
    bastidores,
    proyectos,
    horas,
  };
}

export async function getImportCatalogOptions(importKind: ImportKind = "bastidores") {
  await requireAdmin();
  const [processes, frames, users] = await Promise.all([
    prisma.processDefinition.findMany({
      orderBy: { label: "asc" },
      select: { code: true, label: true },
    }),
    prisma.elementType.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, code: true },
    }),
    importKind === "horas"
      ? prisma.user.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  return { processes, frames, users };
}

export async function getSheetColumnsForMapping(input: {
  sessionId: string;
  sheetName: string;
  importKind?: ImportKind;
}): Promise<SheetColumnOption[]> {
  await requireAdmin();
  const buffer = getImportSessionBuffer(input.sessionId);
  if (!buffer) throw new Error("SESSION_EXPIRED");
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, input.sheetName);
  if (!sheet) return [];
  const kind = input.importKind ?? "bastidores";
  return buildSheetColumnOptions(sheet, 1, columnHintsForKind(kind));
}

export async function parseImportRows(input: {
  sessionId: string;
  mapping: ImportMapping;
  importKind?: ImportKind;
}) {
  await requireAdmin();
  const buffer = getImportSessionBuffer(input.sessionId);
  if (!buffer) throw new Error("SESSION_EXPIRED");
  const wb = await loadWorkbookFromBuffer(buffer);
  const sheet = getWorksheet(wb, input.mapping.sheetName);
  if (!sheet) throw new Error(`Hoja no encontrada: ${input.mapping.sheetName}`);
  const raw = extractMappedRows(sheet, input.mapping);
  const kind = input.importKind ?? "bastidores";
  if (kind === "proyectos") {
    const { parseProyectoRows } = await import("./parse-proyectos");
    return parseProyectoRows(raw);
  }
  if (kind === "horas") {
    const { parseHorasRows } = await import("./parse-horas");
    return parseHorasRows(raw);
  }
  return parseBastidorRows(raw);
}

export async function getProduccionMappings(sheetNames: string[]) {
  return {
    bastidores: suggestMappingForKind(sheetNames, "bastidores"),
    proyectos: suggestMappingForKind(sheetNames, "proyectos"),
    horas: suggestMappingForKind(sheetNames, "horas"),
  };
}
