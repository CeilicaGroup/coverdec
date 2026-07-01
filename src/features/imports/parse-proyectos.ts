import { resolveImportProcessCode } from "./resolve-import-process";
import type { RawMappedRow } from "./excel-workbook";
import {
  deriveHrPending,
  isTerminatedStatus,
  type ProyectoRowDraft,
  type ImportIssue,
} from "./types";

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

export function parseProyectoRows(rawRows: RawMappedRow[]): ProyectoRowDraft[] {
  return rawRows.map((raw) => {
    const projectName = asString(raw.values.projectName);
    const lampName = asString(raw.values.lampName);
    const frameTypeName = asString(raw.values.frameTypeName);
    const surfaceM2 = asNumber(raw.values.surfaceM2);
    const deliveryDate = asDate(raw.values.deliveryDate);
    const areaName = asString(raw.values.areaName);
    const processName = asString(raw.values.processName);
    const hrPlan = asNumber(raw.values.hrPlan);
    const hrTotal = asNumber(raw.values.hrTotal);
    const hrNormal = asNumber(raw.values.hrNormal);
    const hrExtra = asNumber(raw.values.hrExtra);
    const hrPendingRaw = asNumber(raw.values.hrPending);
    const taskStatus = asString(raw.values.taskStatus);
    const projectStatus = asString(raw.values.projectStatus);
    const processCode = processName ? resolveImportProcessCode(processName) : null;

    const hrPending = deriveHrPending({
      hrPlan,
      hrTotal,
      hrPending: hrPendingRaw,
      taskStatus,
    });

    const archiveProject = isTerminatedStatus(projectStatus);

    // Migración histórica: toda fila importada representa trabajo ya registrado en Excel.
    const isCompleted = true;

    const issues: ImportIssue[] = [];

    if (!projectName) {
      issues.push({
        code: "MISSING_PROJECT",
        field: "projectName",
        message: "Falta el nombre del proyecto",
        severity: "error",
      });
    }
    if (!lampName) {
      issues.push({
        code: "MISSING_LAMP",
        field: "lampName",
        message: "Falta el nombre de la lámpara",
        severity: "error",
      });
    }
    if (!frameTypeName) {
      issues.push({
        code: "MISSING_FRAME_TYPE",
        field: "frameTypeName",
        message: "Falta el tipo de bastidor",
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
    if (hrPlan == null) {
      issues.push({
        code: "MISSING_HR_PLAN",
        field: "hrPlan",
        message: "Faltan las horas planificadas (Hr_plan)",
        severity: "error",
      });
    } else if (hrPlan < 0) {
      issues.push({
        code: "INVALID_HR_PLAN",
        field: "hrPlan",
        message: "Hr_plan debe ser >= 0",
        severity: "error",
      });
    }

    const isEmpty =
      !projectName &&
      !lampName &&
      !frameTypeName &&
      !processName &&
      hrPlan == null;
    const hasError = issues.some((i) => i.severity === "error");

    return {
      rowIndex: raw.rowIndex,
      projectName,
      lampName,
      frameTypeName,
      surfaceM2,
      deliveryDate,
      areaName,
      processName,
      hrPlan,
      hrTotal,
      hrNormal,
      hrExtra,
      hrPending,
      taskStatus,
      projectStatus,
      processCode,
      elementTypeId: null,
      elementTypeName: null,
      projectId: null,
      lampId: null,
      taskId: null,
      isCompleted,
      archiveProject,
      issues,
      status: isEmpty ? "skipped" : hasError ? "error" : "ok",
      action: isEmpty || hasError ? "skip" : "create",
    };
  });
}
