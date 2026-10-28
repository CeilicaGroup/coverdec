import { fromDatetimeLocalInputValue, toDatetimeLocalInputValue } from "@/lib/datetime-local";

/**
 * Convención horaria del fichaje (la misma que «Mis horas»): en BD se guardan instantes reales (UTC);
 * las fechas y horas que teclea o ve el usuario son hora mural de Europe/Madrid.
 */

/** «2026-10-20» + «08:00» (hora de Madrid) → instante real. */
export function madridWallTimeToInstant(dateIso: string, hhmm: string): Date {
  return new Date(fromDatetimeLocalInputValue(`${dateIso}T${hhmm}`));
}

/** Día civil en Madrid de un instante. */
export function madridDateIso(date: Date): string {
  return toDatetimeLocalInputValue(date).slice(0, 10);
}

/** «HH:mm» en Madrid de un instante. */
export function madridHhmm(date: Date): string {
  return toDatetimeLocalInputValue(date).slice(11, 16);
}

export function madridMinutesOfDay(date: Date): number {
  const [h, m] = madridHhmm(date).split(":").map(Number);
  return h! * 60 + m!;
}

/** Día ISO de la semana en Madrid: 1 = lunes … 7 = domingo. */
export function madridIsoWeekday(date: Date): number {
  const day = new Date(`${madridDateIso(date)}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

function nextDateIso(dateIso: string): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** [inicio, fin) en instantes reales del día civil de Madrid. */
export function madridDayBounds(dateIso: string): { start: Date; end: Date } {
  return {
    start: madridWallTimeToInstant(dateIso, "00:00"),
    end: madridWallTimeToInstant(nextDateIso(dateIso), "00:00"),
  };
}
