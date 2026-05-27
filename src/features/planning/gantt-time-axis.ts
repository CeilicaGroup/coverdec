import { MORNING_END, MORNING_START } from "@/features/planning/engine/types";
import { defaultWeeklyTemplate } from "@/features/planning/engine/slots/person-schedule";
import { toUtcDay } from "@/lib/week";

export interface GanttDayTimeBounds {
  dayStartMinutes: number;
  dayEndMinutes: number;
}

export interface GanttTimeAxisContext {
  /** Fallback when a weekday has no configured windows. */
  globalBounds: GanttDayTimeBounds;
  boundsForDayIso: (dayIso: string) => GanttDayTimeBounds;
}

export interface WorkWindowRow {
  dayOfWeek: number;
  startMinutes: number;
  endMinutes: number;
}

const DEFAULT_BOUNDS: GanttDayTimeBounds = {
  dayStartMinutes: MORNING_START * 60,
  dayEndMinutes: 17 * 60,
};

function isoWeekdayFromUtcDate(d: Date): number {
  const dow = d.getUTCDay();
  return dow === 0 ? 7 : dow;
}

function boundsFromWindows(windows: WorkWindowRow[]): GanttDayTimeBounds | null {
  if (windows.length === 0) return null;
  let dayStartMinutes = Infinity;
  let dayEndMinutes = -Infinity;
  for (const w of windows) {
    dayStartMinutes = Math.min(dayStartMinutes, w.startMinutes);
    dayEndMinutes = Math.max(dayEndMinutes, w.endMinutes);
  }
  if (!Number.isFinite(dayStartMinutes) || dayEndMinutes <= dayStartMinutes) {
    return null;
  }
  return { dayStartMinutes, dayEndMinutes };
}

/** Min start / max end across all worker windows (or default 08:00–17:00). */
export function computeGlobalWorkerScheduleBounds(
  workWindows: WorkWindowRow[],
): GanttDayTimeBounds {
  const merged =
    boundsFromWindows(workWindows) ??
    boundsFromWindows(
      defaultWeeklyTemplate().flatMap((d) =>
        d.windows.map((w) => ({
          dayOfWeek: d.dayOfWeek,
          startMinutes: w.startMinutes,
          endMinutes: w.endMinutes,
        })),
      ),
    );
  return merged ?? DEFAULT_BOUNDS;
}

export function computeBoundsForDayOfWeek(
  dayOfWeek: number,
  workWindows: WorkWindowRow[],
): GanttDayTimeBounds | null {
  return boundsFromWindows(workWindows.filter((w) => w.dayOfWeek === dayOfWeek));
}

export function buildGanttTimeAxisContext(
  workWindows: WorkWindowRow[],
): GanttTimeAxisContext {
  const globalBounds = computeGlobalWorkerScheduleBounds(workWindows);
  const byWeekday = new Map<number, GanttDayTimeBounds>();

  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek++) {
    const dayBounds = computeBoundsForDayOfWeek(dayOfWeek, workWindows);
    if (dayBounds) byWeekday.set(dayOfWeek, dayBounds);
  }

  return {
    globalBounds,
    boundsForDayIso: (dayIso: string) => {
      const dow = isoWeekdayFromUtcDate(toUtcDay(new Date(`${dayIso}T00:00:00.000Z`)));
      return byWeekday.get(dow) ?? globalBounds;
    },
  };
}

export function daySpanMinutes(bounds: GanttDayTimeBounds): number {
  return Math.max(1, bounds.dayEndMinutes - bounds.dayStartMinutes);
}

/** Fraction [0,1] of the day column for a wall-clock minute. */
export function minuteToDayFraction(
  minute: number,
  bounds: GanttDayTimeBounds,
): number {
  const span = daySpanMinutes(bounds);
  const clamped = Math.max(bounds.dayStartMinutes, Math.min(bounds.dayEndMinutes, minute));
  return (clamped - bounds.dayStartMinutes) / span;
}
