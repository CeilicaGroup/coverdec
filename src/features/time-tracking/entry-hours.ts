export interface TimeEntryHoursInput {
  startedAt: Date;
  endedAt: Date | null;
  hours: number | null;
}

/** Horas de un registro: cerrado usa hours/duración; abierto = desde inicio hasta `at`. */
export function resolveTimeEntryHours(
  entry: TimeEntryHoursInput,
  at: Date = new Date(),
): number {
  if (entry.endedAt != null && typeof entry.hours === "number" && entry.hours > 0) {
    return entry.hours;
  }
  const end = entry.endedAt ?? at;
  return Math.max(0, (end.getTime() - entry.startedAt.getTime()) / 3_600_000);
}
