import {
  getWindowsForDate,
  type PersonScheduleDayInput,
  type PersonScheduleOverrideInput,
  type WorkWindowMinutes,
} from "@/features/planning/engine/slots/person-schedule";
import { isoWeekdayForSchedule } from "@/features/planning/person-day-capacity";

export interface TimeRangeSlice {
  startedAt: Date;
  endedAt: Date;
}

export interface BreakScheduleContext {
  weekly: PersonScheduleDayInput[];
  overrides: PersonScheduleOverrideInput[];
}

export type BreakHandling = "worked_extra" | "took_break";

export interface BreakOverlapSummary {
  hasOverlap: boolean;
  overlapMinutes: number;
  overlapSegments: TimeRangeSlice[];
}

function dateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function atUtcMinutes(day: Date, minutes: number): Date {
  return new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0,
    ),
  );
}

function intersectRange(a: TimeRangeSlice, b: TimeRangeSlice): TimeRangeSlice | null {
  const start = Math.max(a.startedAt.getTime(), b.startedAt.getTime());
  const end = Math.min(a.endedAt.getTime(), b.endedAt.getTime());
  if (end <= start) return null;
  return { startedAt: new Date(start), endedAt: new Date(end) };
}

function breakWindowsForDate(day: Date, schedule: BreakScheduleContext): WorkWindowMinutes[] {
  const override = schedule.overrides.find((item) => dateIso(item.date) === dateIso(day));
  const windows = getWindowsForDate(
    isoWeekdayForSchedule(day),
    schedule.weekly,
    override,
  )
    .filter((window) => window.endMinutes > window.startMinutes)
    .sort((a, b) => a.startMinutes - b.startMinutes);

  if (windows.length < 2) return [];

  const breaks: WorkWindowMinutes[] = [];
  for (let index = 0; index < windows.length - 1; index += 1) {
    const current = windows[index];
    const next = windows[index + 1];
    if (!current || !next) continue;
    if (next.startMinutes > current.endMinutes) {
      breaks.push({
        startMinutes: current.endMinutes,
        endMinutes: next.startMinutes,
      });
    }
  }
  return breaks;
}

function enumerateDaysInRange(range: TimeRangeSlice): Date[] {
  const days: Date[] = [];
  const cursor = new Date(
    Date.UTC(range.startedAt.getUTCFullYear(), range.startedAt.getUTCMonth(), range.startedAt.getUTCDate()),
  );
  const endDay = Date.UTC(range.endedAt.getUTCFullYear(), range.endedAt.getUTCMonth(), range.endedAt.getUTCDate());

  while (cursor.getTime() <= endDay) {
    days.push(new Date(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function breakSegmentsForRange(
  range: TimeRangeSlice,
  schedule: BreakScheduleContext,
): TimeRangeSlice[] {
  const segments: TimeRangeSlice[] = [];
  for (const day of enumerateDaysInRange(range)) {
    const dayBreaks = breakWindowsForDate(day, schedule);
    for (const breakWindow of dayBreaks) {
      const dayBreakSlice = {
        startedAt: atUtcMinutes(day, breakWindow.startMinutes),
        endedAt: atUtcMinutes(day, breakWindow.endMinutes),
      };
      const overlap = intersectRange(range, dayBreakSlice);
      if (overlap) segments.push(overlap);
    }
  }
  return segments;
}

function subtractIntervals(
  range: TimeRangeSlice,
  blockers: TimeRangeSlice[],
): TimeRangeSlice[] {
  let segments = [range];
  for (const blocker of blockers) {
    segments = segments.flatMap((segment) => {
      const overlap = intersectRange(segment, blocker);
      if (!overlap) return [segment];
      const kept: TimeRangeSlice[] = [];
      if (segment.startedAt < overlap.startedAt) {
        kept.push({
          startedAt: segment.startedAt,
          endedAt: overlap.startedAt,
        });
      }
      if (overlap.endedAt < segment.endedAt) {
        kept.push({
          startedAt: overlap.endedAt,
          endedAt: segment.endedAt,
        });
      }
      return kept;
    });
  }
  return segments;
}

export function summarizeBreakOverlap(
  ranges: TimeRangeSlice[],
  schedule: BreakScheduleContext | null,
): BreakOverlapSummary {
  if (!schedule || ranges.length === 0) {
    return { hasOverlap: false, overlapMinutes: 0, overlapSegments: [] };
  }

  const overlapSegments = ranges.flatMap((range) => breakSegmentsForRange(range, schedule));
  const overlapMinutes = overlapSegments.reduce(
    (sum, segment) => sum + (segment.endedAt.getTime() - segment.startedAt.getTime()) / 60000,
    0,
  );

  return {
    hasOverlap: overlapSegments.length > 0,
    overlapMinutes: Math.round(overlapMinutes),
    overlapSegments,
  };
}

export function applyBreakHandling(
  ranges: TimeRangeSlice[],
  schedule: BreakScheduleContext | null,
  breakHandling?: BreakHandling,
): { ranges: TimeRangeSlice[]; overlap: BreakOverlapSummary; appliedBreakHandling?: BreakHandling } {
  const overlap = summarizeBreakOverlap(ranges, schedule);
  if (!overlap.hasOverlap) {
    return { ranges, overlap };
  }
  if (!breakHandling) {
    throw new Error(
      "El registro manual cruza una franja de descanso. Indica si fue trabajo extra o descanso.",
    );
  }
  if (breakHandling === "worked_extra") {
    return { ranges, overlap, appliedBreakHandling: "worked_extra" };
  }

  const adjusted = ranges.flatMap((range) =>
    subtractIntervals(range, breakSegmentsForRange(range, schedule!)),
  );
  if (adjusted.length === 0) {
    throw new Error("El rango indicado corresponde solo a descanso. Ajusta el horario.");
  }
  return { ranges: adjusted, overlap, appliedBreakHandling: "took_break" };
}
