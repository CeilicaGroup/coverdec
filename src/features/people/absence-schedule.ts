import { utcDayStart } from "@/lib/holidays";

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoWeekdayForSchedule(d: Date): number {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 5;
  return wd;
}

export function scheduledHoursForPersonDay(
  date: Date,
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): number {
  const dow = isoWeekdayForSchedule(date);
  let minutes = 0;
  for (const w of workWindows) {
    if (w.dayOfWeek === dow && w.endMinutes > w.startMinutes) {
      minutes += w.endMinutes - w.startMinutes;
    }
  }
  if (minutes <= 0) return 8;
  return Math.round((minutes / 60) * 100) / 100;
}

export function parseUtcDateIso(iso: string): Date {
  return utcDayStart(new Date(`${iso}T00:00:00.000Z`));
}

export function iterateUtcDaysInclusive(startIso: string, endIso: string): Date[] {
  let t = parseUtcDateIso(startIso).getTime();
  const endT = parseUtcDateIso(endIso).getTime();
  if (t > endT) return [];
  const out: Date[] = [];
  for (; t <= endT; t += DAY_MS) {
    out.push(new Date(t));
  }
  return out;
}
