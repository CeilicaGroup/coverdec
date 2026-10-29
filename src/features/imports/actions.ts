"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction, runServerQuery } from "@/lib/server-action";
import { applyBastidorRows } from "./apply-bastidores";
import { applyProyectoRows } from "./apply-proyectos";
import { applyHorasRows } from "./apply-horas";
import { buildPreviewFromSession, IMPORT_SESSION_EXPIRED_MESSAGE } from "./build-preview";
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
import { enrichProyectoPreview, mergeProyectoRowEdits } from "./validate-proyectos";
import { enrichHorasPreview, mergeHorasRowEdits } from "./validate-horas";
import { FULL_MIGRATION_TRANSACTION_TIMEOUT_MS, runImportTransaction } from "./transaction";
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
  ImportPreview,
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
): Promise<ActionResult<ImportInspectResult>> {
  return runServerAction(
    "imports.inspectImportFile",
    async () => {
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
      const wb = await loadWorkbookFromBuffer(buffer).catch((err: unknown) => {
        log.warn({ err, fileName: file.name }, "import file is not a readable xlsx");
        throw new Error(
          `«${file.name}» no es un Excel (.xlsx) válido. Guárdalo como .xlsx y vuelve a subirlo.`,
        );
      });
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
    },
    (result) => ({
      summary: `Analizar archivo de importación (${result.importKind})`,
      metadata: { sessionId: result.sessionId, importKind: result.importKind },
    }),
  );
}

export type ImportPreviewResult = ImportPreview<
  BastidorRowDraft | ProyectoRowDraft | HorasRowDraft
>;

export async function buildImportPreview(input: {
  sessionId: string;
  importKind: ImportKind;
  mapping: ImportMapping;
  rowEdits?: Array<{ rowIndex: number; patch: Record<string, unknown> }>;
}): Promise<ActionResult<ImportPreviewResult>> {
  return runServerAction(
    "imports.buildImportPreview",
    async (): Promise<ImportPreviewResult> => {
      await requireAdmin();
      const importKind = importKindSchema.parse(input.importKind);
      const mapping = mappingSchema.parse(input.mapping) as ImportMapping;
      const kind = effectiveKindForPreview(importKind);

      const preview = await buildPreviewFromSession(input.sessionId, mapping, kind);
      if (!input.rowEdits?.length) return preview;

      if (kind === "proyectos") {
        const merged = mergeProyectoRowEdits(
          preview.rows as ProyectoRowDraft[],
          input.rowEdits as Array<{
            rowIndex: number;
            patch: Partial<ProyectoRowDraft>;
          }>,
        );
        return enrichProyectoPreview(merged);
      }
      if (kind === "horas") {
        const merged = mergeHorasRowEdits(
          preview.rows as HorasRowDraft[],
          input.rowEdits as Array<{
            rowIndex: number;
            patch: Partial<HorasRowDraft>;
          }>,
        );
        return enrichHorasPreview(merged);
      }
      const merged = mergeBastidorRowEdits(
        preview.rows as BastidorRowDraft[],
        input.rowEdits as Array<{
          rowIndex: number;
          patch: Partial<BastidorRowDraft>;
        }>,
      );
      return enrichBastidorPreview(merged);
    },
    { summary: "Vista previa de importación", metadata: { sessionId: input.sessionId } },
  );
}

export async function applyImportPreview(input: {
  sessionId: string;
  importKind: ImportKind;
  rows: BastidorRowDraft[] | ProyectoRowDraft[] | HorasRowDraft[];
}): Promise<ActionResult<ImportApplyResult>> {
  return runServerAction(
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

/**
 * Catálogo → proyectos → horas en una sola transacción: cada hoja se valida contra lo que
 * las anteriores ya escribieron (dentro de la tx) y un fallo en cualquiera deshace todo.
 * Las hojas que no existan en el libro se saltan.
 */
async function applyProduccionCompleta(sessionId: string): Promise<ImportApplyResult> {
  const buffer = getImportSessionBuffer(sessionId);
  if (!buffer) throw new Error(IMPORT_SESSION_EXPIRED_MESSAGE);

  const wb = await loadWorkbookFromBuffer(buffer);
  const sheetNames = listSheetNames(wb);
  const mappingFor = (kind: "bastidores" | "proyectos" | "horas") => {
    const mapping = suggestMappingForKind(sheetNames, kind);
    return getWorksheet(wb, mapping.sheetName) ? mapping : null;
  };
  const bastMapping = mappingFor("bastidores");
  const proyMapping = mappingFor("proyectos");
  const horasMapping = mappingFor("horas");

  const result = await runImportTransaction(async (tx) => {
    const out: ImportApplyResult = { importKind: "produccion_completa" };
    if (bastMapping) {
      const preview = await buildPreviewFromSession(sessionId, bastMapping, "bastidores", tx);
      out.bastidores = await applyBastidorRows(preview.rows as BastidorRowDraft[], tx);
    }
    if (proyMapping) {
      const preview = await buildPreviewFromSession(sessionId, proyMapping, "proyectos", tx);
      out.proyectos = await applyProyectoRows(preview.rows as ProyectoRowDraft[], tx);
    }
    if (horasMapping) {
      const preview = await buildPreviewFromSession(sessionId, horasMapping, "horas", tx);
      out.horas = await applyHorasRows(preview.rows as HorasRowDraft[], tx);
    }
    return out;
  }, FULL_MIGRATION_TRANSACTION_TIMEOUT_MS);

  deleteImportSession(sessionId);
  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/admin/export");

  log.info(
    { bastidores: result.bastidores, proyectos: result.proyectos, horas: result.horas },
    "produccion completa applied",
  );
  return result;
}

export async function getImportCatalogOptions(importKind: ImportKind = "bastidores") {
  return runServerQuery("imports.getImportCatalogOptions", async () => {
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
  });
}

export async function getSheetColumnsForMapping(input: {
  sessionId: string;
  sheetName: string;
  importKind?: ImportKind;
}): Promise<ActionResult<SheetColumnOption[]>> {
  return runServerQuery("imports.getSheetColumnsForMapping", async () => {
    await requireAdmin();
    const buffer = getImportSessionBuffer(input.sessionId);
    if (!buffer) throw new Error(IMPORT_SESSION_EXPIRED_MESSAGE);
    const wb = await loadWorkbookFromBuffer(buffer);
    const sheet = getWorksheet(wb, input.sheetName);
    if (!sheet) return [];
    const kind = input.importKind ?? "bastidores";
    return buildSheetColumnOptions(sheet, 1, columnHintsForKind(kind));
  });
}
