import { prisma } from "@/lib/db";
import { isIsoTimestampString } from "./excel-cell-values";
import { resolveImportProcessCode } from "./resolve-import-process";
import { importSlug } from "./slug";
import type {
  BastidorRowDraft,
  ImportAction,
  ImportPreview,
  ImportPreviewSummary,
  ImportRowStatus,
} from "./types";

function buildSummary<T extends { status: string; action: string }>(
  rows: T[],
): ImportPreviewSummary {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    warning: rows.filter((r) => r.status === "warning").length,
    error: rows.filter((r) => r.status === "error").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    willCreate: rows.filter((r) => r.action === "create").length,
    willUpdate: rows.filter((r) => r.action === "update").length,
    willSkip: rows.filter((r) => r.action === "skip").length,
  };
}

export async function enrichBastidorPreview(
  rows: BastidorRowDraft[],
): Promise<ImportPreview<BastidorRowDraft>> {
  const codes = new Set<string>();
  for (const row of rows) {
    if (row.status === "error" || row.status === "skipped") continue;
    const code =
      row.frameCode?.trim() ||
      importSlug(row.frameName, 64) ||
      row.frameName;
    codes.add(code);
  }

  const existing = await prisma.frameType.findMany({
    where: { code: { in: [...codes] } },
    select: { code: true },
  });
  const existingCodes = new Set(existing.map((f) => f.code));

  const seenKeys = new Set<string>();
  const enriched = rows.map((row) => {
    if (row.status === "skipped") return row;

    const code =
      row.frameCode?.trim() ||
      importSlug(row.frameName, 64) ||
      row.frameName;
    const proc = row.processCode;
    const dupKey = proc ? `${code}::${proc}` : code;

    const issues = [...row.issues].filter((i) => i.code !== "UNKNOWN_PROCESS");
    if (row.status === "ok" && proc && seenKeys.has(dupKey)) {
      issues.push({
        code: "DUPLICATE_IN_FILE",
        message: "Fila duplicada (mismo bastidor y proceso)",
        severity: "warning",
      });
    }
    if (row.status === "ok" && proc) seenKeys.add(dupKey);

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const willUpdate = existingCodes.has(code);

    return {
      ...row,
      issues,
      status: (hasError ? "error" : hasWarning ? "warning" : "ok") as ImportRowStatus,
      action: (hasError ? "skip" : willUpdate ? "update" : "create") as ImportAction,
    };
  });

  return { rows: enriched, summary: buildSummary(enriched) };
}

export function mergeBastidorRowEdits(
  rows: BastidorRowDraft[],
  edits: Array<{ rowIndex: number; patch: Partial<BastidorRowDraft> }>,
): BastidorRowDraft[] {
  const byIndex = new Map(edits.map((e) => [e.rowIndex, e.patch]));
  return rows.map((row) => {
    const patch = byIndex.get(row.rowIndex);
    if (!patch) return row;
    const merged = { ...row, ...patch };
    if (patch.processCode !== undefined) {
      merged.processCode = patch.processCode;
    } else if (merged.processName) {
      merged.processCode = resolveImportProcessCode(merged.processName);
    }
    merged.issues = merged.issues.filter(
      (i) =>
        ![
          "MISSING_FRAME_NAME",
          "INVALID_FRAME_NAME",
          "MISSING_PROCESS",
          "UNKNOWN_PROCESS",
          "MISSING_HOURS",
          "INVALID_HOURS",
        ].includes(i.code),
    );
    if (!merged.frameName) {
      merged.issues.push({
        code: "MISSING_FRAME_NAME",
        field: "frameName",
        message: "Falta el nombre del bastidor",
        severity: "error",
      });
    } else if (isIsoTimestampString(merged.frameName)) {
      merged.issues.push({
        code: "INVALID_FRAME_NAME",
        field: "frameName",
        message:
          "Nombre de bastidor no válido (celda con fecha en el Excel; revisa el mapeo de columnas)",
        severity: "error",
      });
    }
    if (!merged.processName) {
      merged.issues.push({
        code: "MISSING_PROCESS",
        field: "processName",
        message: "Falta el proceso",
        severity: "error",
      });
    }
    if (merged.processName && !merged.processCode) {
      merged.issues.push({
        code: "UNKNOWN_PROCESS",
        field: "processName",
        message: `No se pudo derivar un código de proceso válido: "${merged.processName}"`,
        severity: "error",
      });
    }
    if (merged.hoursPerUnit == null) {
      merged.issues.push({
        code: "MISSING_HOURS",
        field: "hoursPerUnit",
        message: "Faltan las horas por unidad",
        severity: "error",
      });
    }
    const hasError = merged.issues.some((i) => i.severity === "error");
    merged.status = hasError ? "error" : merged.issues.length ? "warning" : "ok";
    if (patch.action !== undefined) {
      merged.action = patch.action;
    } else if (hasError) {
      merged.action = "skip";
    }
    return merged;
  });
}
