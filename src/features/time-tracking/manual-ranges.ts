import { toDatetimeLocalInputValue } from "@/lib/datetime-local";

export interface TimeRange {
  startedAt: Date;
  endedAt: Date;
}

export const FUTURE_CALENDAR_DAY_ERROR =
  "No se pueden registrar horas en días futuros. Usa la fecha de hoy o anterior.";

function madridDayIso(date: Date): string {
  return toDatetimeLocalInputValue(date).slice(0, 10);
}

export function assertNoFutureCalendarDays(
  ranges: TimeRange[],
  now: Date = new Date(),
): void {
  const todayIso = madridDayIso(now);
  for (const range of ranges) {
    if (madridDayIso(range.startedAt) > todayIso || madridDayIso(range.endedAt) > todayIso) {
      throw new Error(FUTURE_CALENDAR_DAY_ERROR);
    }
  }
}

export function assertNoInternalOverlaps(ranges: TimeRange[]) {
  const sorted = [...ranges].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    if (r.endedAt.getTime() <= r.startedAt.getTime()) {
      throw new Error("Rango inválido: el fin debe ser posterior al inicio.");
    }
    if (i === 0) continue;
    const prev = sorted[i - 1];
    if (r.startedAt.getTime() < prev.endedAt.getTime()) {
      throw new Error("Rangos inválidos: hay solape entre rangos.");
    }
  }
}

export function computeTotalHours(ranges: TimeRange[]): number {
  return ranges.reduce(
    (acc, r) => acc + (r.endedAt.getTime() - r.startedAt.getTime()) / 3600000,
    0,
  );
}
