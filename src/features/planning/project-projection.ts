import { toUtcDay } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Estima fin de obra sumando días laborables según horas pendientes y capacidad diaria del equipo. */
export function estimateExpectedCompletion(args: {
  pendingHours: number;
  fromDate: Date;
  teamDailyCapacity: number;
  holidayDates: Set<string>;
}): Date | null {
  const { pendingHours, fromDate, teamDailyCapacity, holidayDates } = args;
  if (pendingHours <= 0) return null;
  if (teamDailyCapacity <= 0) return null;

  const daysNeeded = Math.ceil(pendingHours / teamDailyCapacity);
  let remaining = daysNeeded;
  let cursor = toUtcDay(fromDate);

  while (remaining > 0) {
    const key = cursor.toISOString().slice(0, 10);
    if (!isWeekend(cursor) && !holidayDates.has(key)) {
      remaining -= 1;
    }
    if (remaining > 0) {
      cursor = new Date(cursor.getTime() + DAY_MS);
    }
  }

  return cursor;
}
