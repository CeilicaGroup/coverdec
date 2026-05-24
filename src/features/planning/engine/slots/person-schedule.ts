import { MORNING_END, MORNING_START, WORKDAY_HOURS } from "../types";

/** Quarter-hour units per productive day (8h × 4). */
export const QUARTERS_PER_HOUR = 4;
export const DEFAULT_DAY_QUARTERS = WORKDAY_HOURS * QUARTERS_PER_HOUR;

export interface WorkWindowMinutes {
  startMinutes: number;
  endMinutes: number;
}

export interface PersonScheduleDayInput {
  dayOfWeek: number;
  windows: WorkWindowMinutes[];
}

export interface PersonScheduleOverrideInput {
  date: Date;
  windows: WorkWindowMinutes[];
}

const DEFAULT_WINDOWS: WorkWindowMinutes[] = [
  { startMinutes: MORNING_START * 60, endMinutes: MORNING_END * 60 },
  { startMinutes: 15 * 60, endMinutes: 17 * 60 },
];

export function defaultWeeklyTemplate(): PersonScheduleDayInput[] {
  return [1, 2, 3, 4, 5].map((dayOfWeek) => ({
    dayOfWeek,
    windows: DEFAULT_WINDOWS,
  }));
}

export function minutesToProductiveQuarters(windows: WorkWindowMinutes[]): number {
  let total = 0;
  for (const w of windows) {
    const span = Math.max(0, w.endMinutes - w.startMinutes);
    total += Math.round(span / 15);
  }
  return total;
}

export function getWindowsForDate(
  dayOfWeek: number,
  weekly: PersonScheduleDayInput[],
  override: PersonScheduleOverrideInput | undefined,
): WorkWindowMinutes[] {
  if (override) return override.windows;
  const day = weekly.find((w) => w.dayOfWeek === dayOfWeek);
  return day?.windows ?? DEFAULT_WINDOWS;
}

export function contractQuartersForDay(
  dayOfWeek: number,
  weekly: PersonScheduleDayInput[],
  override: PersonScheduleOverrideInput | undefined,
  absenceHours: number,
): number {
  const windows = getWindowsForDate(dayOfWeek, weekly, override);
  if (override && windows.length === 0) return 0;
  const raw = minutesToProductiveQuarters(windows);
  const absenceQ = Math.round(absenceHours * QUARTERS_PER_HOUR);
  return Math.max(0, raw - absenceQ);
}

export function maxQuartersForDay(
  dayOfWeek: number,
  weekly: PersonScheduleDayInput[],
  override: PersonScheduleOverrideInput | undefined,
): number {
  const windows = getWindowsForDate(dayOfWeek, weekly, override);
  if (override && windows.length === 0) return 0;
  return minutesToProductiveQuarters(windows);
}

/** Fallback when no template rows exist yet. */
export function fallbackContractQuarters(
  capacityHours: number,
  absenceHours: number,
): number {
  const capQ =
    capacityHours > 0
      ? Math.round(capacityHours * QUARTERS_PER_HOUR)
      : DEFAULT_DAY_QUARTERS;
  const absenceQ = Math.round(absenceHours * QUARTERS_PER_HOUR);
  return Math.max(0, capQ - absenceQ);
}
