import type { CellValue } from "exceljs";
import { readNumber, readString } from "@/lib/excel/cell";
import { readExcelDate } from "./excel-date-time";

function unwrapFormulaResult(value: CellValue | undefined): CellValue | undefined {
  if (value == null) return value;
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: CellValue }).result;
    return result ?? undefined;
  }
  return value;
}

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function isIsoTimestampString(value: string): boolean {
  return ISO_TIMESTAMP_RE.test(value.trim());
}

function cellHasDateValue(value: CellValue | undefined): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    return result instanceof Date && !Number.isNaN(result.getTime());
  }
  return false;
}

/** IFERROR(...,"fallback") — common in PRODUCCION.xlsx when cached result is missing. */
export function extractIfErrorStringFallback(formula: string): string | null {
  const match = formula.match(/,"((?:[^"\\]|"")*)"\s*\)\s*$/);
  if (!match?.[1]) return null;
  const decoded = match[1].replace(/""/g, '"').trim();
  return decoded.length > 0 ? decoded : null;
}

function readFormulaCellText(value: CellValue): string | null {
  if (typeof value !== "object" || !value || !("formula" in value)) return null;
  const cell = value as { formula?: string; result?: unknown };
  const { result, formula } = cell;

  if (typeof result === "string") {
    const trimmed = result.trim();
    if (trimmed && !isIsoTimestampString(trimmed)) return trimmed;
  }
  if (typeof result === "number") return String(result);
  if (result instanceof Date && !Number.isNaN(result.getTime())) return null;

  if (formula) return extractIfErrorStringFallback(formula);
  return null;
}

/** Reads a mapped text field; ignores Excel date cells and ISO timestamps. */
export function readMappedTextCell(
  value: CellValue | undefined,
): string | null {
  if (value == null || cellHasDateValue(value)) return null;
  if (typeof value === "object" && value && "formula" in value) {
    const fromFormula = readFormulaCellText(value);
    if (fromFormula) return fromFormula;
  }
  const text = readString(value);
  if (!text || isIsoTimestampString(text)) return null;
  return text;
}

/** Reads a mapped numeric field (hours, etc.). */
export function readMappedNumberCell(
  value: CellValue | undefined,
): number | null {
  return readNumber(unwrapFormulaResult(value));
}

/** Reads a mapped date field (delivery date, work date). */
export function readMappedDateCell(value: CellValue | undefined): Date | null {
  return readExcelDate(value);
}
