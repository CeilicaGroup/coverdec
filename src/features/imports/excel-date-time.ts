import type { CellValue } from "exceljs";

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

function unwrapCellValue(value: CellValue | undefined): unknown {
  if (value == null) return null;
  if (typeof value === "object" && value && "result" in value) {
    return (value as { result?: unknown }).result ?? null;
  }
  return value;
}

/** Excel serial date (days since 1899-12-30) to UTC midnight Date. */
export function excelSerialToDate(serial: number): Date {
  const wholeDays = Math.floor(serial);
  const ms = EXCEL_EPOCH_MS + wholeDays * 86_400_000;
  return new Date(ms);
}

/** Reads a calendar date from Excel (serial, Date, or ISO string). */
export function readExcelDate(value: CellValue | undefined): Date | null {
  const raw = unwrapCellValue(value);
  if (raw == null) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime())
      ? null
      : new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw > 1 && raw < 100_000) return excelSerialToDate(raw);
    if (raw >= 0 && raw < 1) return null;
    return excelSerialToDate(raw);
  }
  if (typeof raw === "string") {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return null;
}

/** Minutes from midnight for Excel time (fraction of day or time-only Date). */
export function readExcelTimeOfDay(value: CellValue | undefined): number | null {
  const raw = unwrapCellValue(value);
  if (raw == null) return null;
  if (raw instanceof Date) {
    return raw.getUTCHours() * 60 + raw.getUTCMinutes() + raw.getUTCSeconds() / 60;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    if (raw >= 0 && raw < 1) return raw * 24 * 60;
    if (raw >= 1) {
      const frac = raw - Math.floor(raw);
      return frac * 24 * 60;
    }
  }
  if (typeof raw === "string") {
    const match = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    const s = match[3] ? Number(match[3]) : 0;
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m + s / 60;
  }
  return null;
}

/** Combines a calendar date with minutes-from-midnight (UTC). */
export function combineDateAndTime(baseDate: Date, minutesFromMidnight: number): Date {
  const dayStart = Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
  );
  return new Date(dayStart + minutesFromMidnight * 60_000);
}

export function addHoursToDate(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3_600_000);
}
