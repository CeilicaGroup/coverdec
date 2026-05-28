import { isIsoTimestampString } from "./excel-cell-values";
import { resolveImportProcessCode } from "./resolve-import-process";
import type { RawMappedRow } from "./excel-workbook";
import type { BastidorRowDraft, ImportIssue } from "./types";

function asString(value: string | number | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function asNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseBastidorRows(rawRows: RawMappedRow[]): BastidorRowDraft[] {
  return rawRows.map((raw) => {
    const frameName = asString(raw.values.frameName);
    const processName = asString(raw.values.processName);
    const hoursPerUnit = asNumber(raw.values.hoursPerUnit);
    const frameCodeRaw = asString(raw.values.frameCode);
    const frameCode = frameCodeRaw.length > 0 ? frameCodeRaw : null;
    const processCode = processName ? resolveImportProcessCode(processName) : null;

    const issues: ImportIssue[] = [];

    if (!frameName) {
      issues.push({
        code: "MISSING_FRAME_NAME",
        field: "frameName",
        message: "Falta el nombre del bastidor",
        severity: "error",
      });
    } else if (isIsoTimestampString(frameName)) {
      issues.push({
        code: "INVALID_FRAME_NAME",
        field: "frameName",
        message:
          "Nombre de bastidor no válido (celda con fecha en el Excel; revisa el mapeo de columnas)",
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
    if (hoursPerUnit == null) {
      issues.push({
        code: "MISSING_HOURS",
        field: "hoursPerUnit",
        message: "Faltan las horas por unidad",
        severity: "error",
      });
    } else if (hoursPerUnit < 0) {
      issues.push({
        code: "INVALID_HOURS",
        field: "hoursPerUnit",
        message: "Las horas deben ser >= 0",
        severity: "error",
      });
    }

    const hasError = issues.some((i) => i.severity === "error");
    const isEmpty = !frameName && !processName && hoursPerUnit == null;

    return {
      rowIndex: raw.rowIndex,
      frameName,
      processName,
      hoursPerUnit,
      frameCode,
      processCode,
      issues,
      status: isEmpty ? "skipped" : hasError ? "error" : "ok",
      action: isEmpty || hasError ? "skip" : "create",
    };
  });
}
