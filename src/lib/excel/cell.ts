import type { CellValue } from "exceljs";

export function readNumber(value: CellValue | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === "number") return result;
    if (typeof result === "string") {
      const n = Number(result);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function readString(value: CellValue | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) {
      return Number.isNaN(result.getTime()) ? null : result.toISOString();
    }
    return result != null ? String(result).trim() || null : null;
  }
  if (typeof value === "object" && value && "richText" in value) {
    const rich = value as { richText?: { text: string }[] };
    return rich.richText?.map((rt) => rt.text).join(" ").trim() || null;
  }
  return null;
}

export function readDate(value: CellValue | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return result;
    if (typeof result === "string") {
      const d = new Date(result);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}
