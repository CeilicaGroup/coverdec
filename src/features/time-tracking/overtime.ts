import { madridDateIso } from "@/features/attendance/madrid-time";

/** Regla de Ceilica: es extra todo lo que pasa de 8 h por persona y día. */
export const DAILY_NORMAL_HOURS = 8;

export interface OvertimeEntry {
  id: string;
  userId: string;
  startedAt: Date;
  /** Horas ya resueltas del fichaje (ver resolveTimeEntryHours). */
  hours: number;
}

/**
 * Horas extra de cada fichaje: por persona y día civil de Madrid, en orden de
 * inicio, las primeras 8 h son normales y el resto extra. Un fichaje que cruza
 * el límite se reparte. Devuelve solo los fichajes con extra > 0.
 */
export function splitOvertimeByEntry(
  entries: OvertimeEntry[],
  dailyLimit: number = DAILY_NORMAL_HOURS,
): Map<string, number> {
  const byPersonDay = new Map<string, OvertimeEntry[]>();
  for (const entry of entries) {
    const key = `${entry.userId}:${madridDateIso(entry.startedAt)}`;
    const list = byPersonDay.get(key) ?? [];
    list.push(entry);
    byPersonDay.set(key, list);
  }

  const extraById = new Map<string, number>();
  for (const list of byPersonDay.values()) {
    list.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    let used = 0;
    for (const entry of list) {
      const hours = Math.max(0, entry.hours);
      const normal = Math.min(hours, Math.max(0, dailyLimit - used));
      used += hours;
      const extra = hours - normal;
      if (extra > 1e-9) extraById.set(entry.id, extra);
    }
  }
  return extraById;
}
