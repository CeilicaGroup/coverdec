const DAY_MS = 24 * 60 * 60 * 1000;

/** Normaliza a medianoche UTC del día civil. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isoDayKey(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
}

/**
 * Días ISO (YYYY-MM-DD) que caen en algún rango festivo y dentro de la ventana [windowStart, windowEnd] (inclusive por día UTC).
 */
export function expandHolidayRangesToIsoDays(
  ranges: { startDate: Date; endDate: Date }[],
  windowStart: Date,
  windowEnd: Date,
): Set<string> {
  const ws = utcDayStart(windowStart).getTime();
  const we = utcDayStart(windowEnd).getTime();
  const out = new Set<string>();
  for (const r of ranges) {
    let t = utcDayStart(r.startDate).getTime();
    const endT = utcDayStart(r.endDate).getTime();
    for (; t <= endT; t += DAY_MS) {
      if (t >= ws && t <= we) out.add(new Date(t).toISOString().slice(0, 10));
    }
  }
  return out;
}
