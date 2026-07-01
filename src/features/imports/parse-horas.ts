import { resolveImportProcessCode } from "./resolve-import-process";
import type { RawMappedRow } from "./excel-workbook";
import type { HorasRowDraft, ImportIssue } from "./types";

function asString(value: string | number | Date | null | undefined): string {
  if (value == null) return "";
  if (value instanceof Date) return "";
  return String(value).trim();
}

function asNumber(value: string | number | Date | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function asDate(value: string | number | Date | null | undefined): Date | null {
  if (value instanceof Date) return value;
  return null;
}

function asTimeMinutes(
  value: string | number | Date | null | undefined,
): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function parseHorasRows(rawRows: RawMappedRow[]): HorasRowDraft[] {
  return rawRows.map((raw) => {
    const workDate = asDate(raw.values.workDate);
    const operatorName = asString(raw.values.operatorName);
    const projectName = asString(raw.values.projectName);
    const lampName = asString(raw.values.lampName);
    const areaName = asString(raw.values.areaName);
    const processName = asString(raw.values.processName);
    const startTimeMinutes = asTimeMinutes(raw.values.startTime);
    const endTimeMinutes = asTimeMinutes(raw.values.endTime);
    const normalHours = asNumber(raw.values.normalHours);
    const extraHours = asNumber(raw.values.extraHours);
    const notes = asString(raw.values.notes);
    const processCode = processName ? resolveImportProcessCode(processName) : null;

    const totalHours =
      (normalHours ?? 0) + (extraHours ?? 0) > 0
        ? (normalHours ?? 0) + (extraHours ?? 0)
        : null;

    const issues: ImportIssue[] = [];

    if (!workDate) {
      issues.push({
        code: "MISSING_DATE",
        field: "workDate",
        message: "Falta la fecha del parte",
        severity: "error",
      });
    }
    if (!operatorName) {
      issues.push({
        code: "MISSING_OPERATOR",
        field: "operatorName",
        message: "Falta el operario",
        severity: "error",
      });
    }
    if (!projectName) {
      issues.push({
        code: "MISSING_PROJECT",
        field: "projectName",
        message: "Falta el proyecto",
        severity: "error",
      });
    }
    if (!lampName) {
      issues.push({
        code: "MISSING_LAMP",
        field: "lampName",
        message: "Falta la lámpara",
        severity: "error",
      });
    }
    if (!processName) {
      issues.push({
        code: "MISSING_PROCESS",
        field: "processName",
        message: "Falta el proceso",
        severity: "error",
      });
    }
    if (processName && !processCode) {
      issues.push({
        code: "UNKNOWN_PROCESS",
        field: "processName",
        message: `No se pudo derivar un código de proceso válido: "${processName}"`,
        severity: "error",
      });
    }
    if (totalHours == null || totalHours <= 0) {
      issues.push({
        code: "MISSING_HOURS",
        field: "normalHours",
        message: "Faltan horas normales o extras",
        severity: "error",
      });
    }

    const isEmpty =
      !operatorName && !projectName && !lampName && !processName && totalHours == null;
    const hasError = issues.some((i) => i.severity === "error");

    return {
      rowIndex: raw.rowIndex,
      workDate,
      operatorName,
      projectName,
      lampName,
      areaName,
      processName,
      startTimeMinutes,
      endTimeMinutes,
      normalHours,
      extraHours,
      notes,
      totalHours,
      processCode,
      userId: null,
      operatorLabel: null,
      projectId: null,
      lampId: null,
      taskId: null,
      startedAt: null,
      endedAt: null,
      issues,
      status: isEmpty ? "skipped" : hasError ? "error" : "ok",
      action: isEmpty || hasError ? "skip" : "create",
    };
  });
}
