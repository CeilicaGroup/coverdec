import type { CellValue } from "exceljs";
import { readNumber, readString } from "@/lib/excel/cell";

const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function isIsoTimestampString(value: string): boolean {
  return ISO_TIMESTAMP_RE.test(value.trim());
}

function cellHasDateValue(value: CellValue | undefined): boolean {
  if (value instanceof Date) return true;
  if (typeof value === "object" && value && "result" in value) {
    return (value as { result?: unknown }).result instanceof Date;
  }
  return false;
}

/** Reads a mapped text field; ignores Excel date cells and ISO timestamps. */
export function readMappedTextCell(
  value: CellValue | undefined,
): string | null {
  if (value == null || cellHasDateValue(value)) return null;
  const text = readString(value);
  if (!text || isIsoTimestampString(text)) return null;
  return text;
}

/** Reads a mapped numeric field (hours, etc.). */
export function readMappedNumberCell(
  value: CellValue | undefined,
): number | null {
  return readNumber(value);
}
