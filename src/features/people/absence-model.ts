import {
  parseUtcDateIso,
  scheduledHoursForPersonDay,
} from "@/features/people/absence-schedule";
import { expandCivilIsoRange } from "@/lib/civil-date";
import type { EngineAbsence } from "@/features/planning/engine/types";

/** Franja de día completo (00:00–24:00 civil). */
export const FULL_DAY_BLOCK_START = 0;
export const FULL_DAY_BLOCK_END = 24 * 60;

export interface AbsenceSpan {
  date: Date;
  endDate: Date;
  hours: number;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

export function absenceCivilIsoStart(a: { date: Date }): string {
  return a.date.toISOString().slice(0, 10);
}

export function absenceCivilIsoEnd(a: { date: Date; endDate: Date }): string {
  return a.endDate.toISOString().slice(0, 10);
}

export function isFullDayAbsenceBlock(a: {
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}): boolean {
  return (
    a.blockStartMinutes === FULL_DAY_BLOCK_START &&
    a.blockEndMinutes === FULL_DAY_BLOCK_END
  );
}

export function isRangeAbsence(a: { date: Date; endDate: Date }): boolean {
  return absenceCivilIsoEnd(a) > absenceCivilIsoStart(a);
}

export function absenceCoversCivilIso(
  a: { date: Date; endDate: Date },
  iso: string,
): boolean {
  return iso >= absenceCivilIsoStart(a) && iso <= absenceCivilIsoEnd(a);
}

export function absenceOverlapsWindow(
  a: { date: Date; endDate: Date },
  windowStart: Date,
  windowEnd: Date,
): boolean {
  return a.date.getTime() <= windowEnd.getTime() && a.endDate.getTime() >= windowStart.getTime();
}

export function absenceOverlapPrismaFilter(windowStart: Date, windowEnd: Date) {
  return {
    date: { lte: windowEnd },
    endDate: { gte: windowStart },
  };
}

export function civilIsoDaysCoveredByAbsence(a: { date: Date; endDate: Date }): string[] {
  return expandCivilIsoRange(absenceCivilIsoStart(a), absenceCivilIsoEnd(a));
}

export function totalScheduledHoursForAbsence(
  absence: AbsenceSpan,
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  let total = 0;
  for (const iso of civilIsoDaysCoveredByAbsence(absence)) {
    total += scheduledHoursForPersonDay(parseUtcDateIso(iso), workWindows);
  }
  return Math.round(total * 100) / 100;
}

export function effectiveAbsenceHoursOnDay(
  absence: AbsenceSpan,
  dayIso: string,
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  if (!absenceCoversCivilIso(absence, dayIso)) return 0;
  if (isFullDayAbsenceBlock(absence)) {
    return scheduledHoursForPersonDay(parseUtcDateIso(dayIso), workWindows);
  }
  if (absenceCivilIsoStart(absence) !== absenceCivilIsoEnd(absence)) return 0;
  return absence.hours;
}

export function sumEffectiveAbsenceHoursForPersonOnDay(
  absences: (AbsenceSpan & { personId: string })[],
  personId: string,
  dayIso: string,
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  return absences
    .filter((a) => a.personId === personId && absenceCoversCivilIso(a, dayIso))
    .reduce((sum, a) => sum + effectiveAbsenceHoursOnDay(a, dayIso, workWindows), 0);
}

export function expandAbsenceToEngineDays(
  absence: AbsenceSpan & { personId: string },
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
  windowStart: Date,
  windowEnd: Date,
): EngineAbsence[] {
  const out: EngineAbsence[] = [];
  for (const iso of civilIsoDaysCoveredByAbsence(absence)) {
    const day = parseUtcDateIso(iso);
    if (day.getTime() < windowStart.getTime() || day.getTime() > windowEnd.getTime()) {
      continue;
    }
    if (isFullDayAbsenceBlock(absence)) {
      out.push({
        personId: absence.personId,
        date: day,
        hours: scheduledHoursForPersonDay(day, workWindows),
        blockStartMinutes: FULL_DAY_BLOCK_START,
        blockEndMinutes: FULL_DAY_BLOCK_END,
      });
      continue;
    }
    if (iso !== absenceCivilIsoStart(absence)) continue;
    out.push({
      personId: absence.personId,
      date: day,
      hours: absence.hours,
      blockStartMinutes: absence.blockStartMinutes,
      blockEndMinutes: absence.blockEndMinutes,
    });
  }
  return out;
}
