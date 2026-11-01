const DAY_MS = 24 * 60 * 60 * 1000;

export function toUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function getMondayOf(date: Date): Date {
  const utc = toUtcDay(date);
  const dow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  return new Date(utc.getTime() - (dow - 1) * DAY_MS);
}

/** Semana ISO 8601: la del jueves de esa semana, contada desde el 1 de enero de su año. */
export function isoWeek(date: Date): { year: number; week: number } {
  const target = toUtcDay(date);
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const year = target.getUTCFullYear();
  const dayDiff = (target.getTime() - Date.UTC(year, 0, 1)) / DAY_MS;
  return { year, week: 1 + Math.floor(dayDiff / 7) };
}

export function isSameUtcDay(a: Date, b: Date): boolean {
  return toUtcDay(a).getTime() === toUtcDay(b).getTime();
}

/** Días laborables de la semana: lun–vie, o lun–sáb (count 6) si ese sábado se trabaja. */
export function weekDays(weekStart: Date, count: 5 | 6 = 5): Date[] {
  const monday = getMondayOf(weekStart);
  return Array.from({ length: count }, (_, i) => new Date(monday.getTime() + i * DAY_MS));
}

export function parseWeekParam(value: string | undefined): Date {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return getMondayOf(parsed);
  }
  return getMondayOf(new Date());
}

export function formatWeekRange(weekStart: Date): string {
  const days = weekDays(weekStart);
  const first = days[0];
  const last = days[4];
  const formatter = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(first)} – ${formatter.format(last)}`;
}

export function shiftWeek(weekStart: Date, deltaWeeks: number): Date {
  return new Date(getMondayOf(weekStart).getTime() + deltaWeeks * 7 * DAY_MS);
}

export function isCreatedThisWeek(date: Date, now: Date = new Date()): boolean {
  return date >= getMondayOf(now);
}
