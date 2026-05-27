import {
  contractQuartersForDay,
  defaultWeeklyTemplate,
  type PersonScheduleDayInput,
  type PersonScheduleOverrideInput,
  QUARTERS_PER_HOUR,
} from "./engine/slots/person-schedule";

export function isoWeekdayForSchedule(date: Date): number {
  const wd = date.getUTCDay();
  if (wd === 0 || wd === 6) return 5;
  return wd;
}

export function buildWeeklyScheduleFromWorkWindows(
  windows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[],
): PersonScheduleDayInput[] {
  if (windows.length === 0) return defaultWeeklyTemplate();
  const byDay = new Map<number, PersonScheduleDayInput["windows"]>();
  for (const w of windows) {
    const list = byDay.get(w.dayOfWeek) ?? [];
    list.push({ startMinutes: w.startMinutes, endMinutes: w.endMinutes });
    byDay.set(w.dayOfWeek, list);
  }
  return [...byDay.entries()].map(([dayOfWeek, dayWindows]) => ({
    dayOfWeek,
    windows: dayWindows.sort((a, b) => a.startMinutes - b.startMinutes),
  }));
}

export function buildScheduleOverrides(
  rows: {
    date: Date;
    windows: { startMinutes: number; endMinutes: number }[];
  }[],
): PersonScheduleOverrideInput[] {
  return rows.map((row) => ({
    date: row.date,
    windows: row.windows.map((w) => ({
      startMinutes: w.startMinutes,
      endMinutes: w.endMinutes,
    })),
  }));
}

export function computePersonDayCapacityHours(input: {
  day: Date;
  weekly: PersonScheduleDayInput[];
  overrides: PersonScheduleOverrideInput[];
  absenceHours: number;
  isHoliday: boolean;
}): number {
  if (input.isHoliday) return 0;
  const dateIso = input.day.toISOString().slice(0, 10);
  const override = input.overrides.find(
    (o) => o.date.toISOString().slice(0, 10) === dateIso,
  );
  const quarters = contractQuartersForDay(
    isoWeekdayForSchedule(input.day),
    input.weekly,
    override,
    input.absenceHours,
  );
  return quarters / QUARTERS_PER_HOUR;
}

export interface PersonScheduleContext {
  weekly: PersonScheduleDayInput[];
  overrides: PersonScheduleOverrideInput[];
}

export function personScheduleContextFromPerson(person: {
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
  scheduleOverrides: {
    date: Date;
    windows: { startMinutes: number; endMinutes: number }[];
  }[];
}): PersonScheduleContext {
  return {
    weekly: buildWeeklyScheduleFromWorkWindows(person.workWindows),
    overrides: buildScheduleOverrides(person.scheduleOverrides),
  };
}
