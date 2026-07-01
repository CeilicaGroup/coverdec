import {
  combineDateAndTime,
} from "./excel-date-time";
import {
  defaultWeeklyTemplate,
  type WorkWindowMinutes,
} from "@/features/planning/engine/slots/person-schedule";
import { isoWeekdayForSchedule } from "@/features/planning/person-day-capacity";

export interface TimeSlotInput {
  rowIndex: number;
  hours: number;
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
}

export interface AllocatedTimeSlot {
  rowIndex: number;
  startedAt: Date;
  endedAt: Date;
  overflow: boolean;
}

export interface AllocateSlotsWarning {
  rowIndex: number;
  code: string;
  message: string;
}

export interface AllocateSlotsResult {
  slots: AllocatedTimeSlot[];
  warnings: AllocateSlotsWarning[];
}

const OVERFLOW_START_MINUTES = 17 * 60;

function windowsForDay(
  workDate: Date,
  weeklyWindows: WorkWindowMinutes[],
): WorkWindowMinutes[] {
  if (weeklyWindows.length > 0) return weeklyWindows;
  const dayOfWeek = isoWeekdayForSchedule(workDate);
  const template = defaultWeeklyTemplate();
  const day = template.find((d) => d.dayOfWeek === dayOfWeek);
  return day?.windows ?? defaultWeeklyTemplate()[0]!.windows;
}

function allocateInWindows(
  workDate: Date,
  windows: WorkWindowMinutes[],
  hours: number,
  cursorMinutes: number,
): { startedAt: Date; endedAt: Date; nextCursor: number; overflow: boolean } {
  let remainingHours = hours;
  let startMinutes: number | null = null;
  let endMinutes = cursorMinutes;
  let overflow = false;

  const sorted = [...windows].sort((a, b) => a.startMinutes - b.startMinutes);

  for (const window of sorted) {
    if (remainingHours <= 0) break;
    const pos = Math.max(cursorMinutes, window.startMinutes);
    if (pos >= window.endMinutes) continue;

    const availableHours = (window.endMinutes - pos) / 60;
    const usedHours = Math.min(remainingHours, availableHours);
    if (usedHours <= 0) continue;

    if (startMinutes === null) startMinutes = pos;
    remainingHours -= usedHours;
    endMinutes = pos + usedHours * 60;
    cursorMinutes = endMinutes;
  }

  if (remainingHours > 0) {
    overflow = true;
    const overflowStart = Math.max(cursorMinutes, OVERFLOW_START_MINUTES);
    if (startMinutes === null) startMinutes = overflowStart;
    endMinutes = overflowStart + remainingHours * 60;
    cursorMinutes = endMinutes;
  }

  const startedAt = combineDateAndTime(workDate, startMinutes ?? cursorMinutes);
  const endedAt = combineDateAndTime(workDate, endMinutes);

  return { startedAt, endedAt, nextCursor: endMinutes, overflow };
}

export function allocateSequentialTimeSlots(input: {
  workDate: Date;
  entries: TimeSlotInput[];
  weeklyWindows?: WorkWindowMinutes[];
}): AllocateSlotsResult {
  const warnings: AllocateSlotsWarning[] = [];
  const slots: AllocatedTimeSlot[] = [];
  const windows = windowsForDay(input.workDate, input.weeklyWindows ?? []);
  let cursorMinutes = windows[0]?.startMinutes ?? 8 * 60;

  const sorted = [...input.entries].sort((a, b) => a.rowIndex - b.rowIndex);

  for (const entry of sorted) {
    if (entry.hours <= 0) {
      warnings.push({
        rowIndex: entry.rowIndex,
        code: "ZERO_HOURS",
        message: "La fila no tiene horas imputables",
      });
      continue;
    }

    if (
      entry.startTimeMinutes != null &&
      entry.endTimeMinutes != null &&
      entry.endTimeMinutes > entry.startTimeMinutes
    ) {
      const startedAt = combineDateAndTime(input.workDate, entry.startTimeMinutes);
      const endedAt = combineDateAndTime(input.workDate, entry.endTimeMinutes);
      const actualHours =
        (endedAt.getTime() - startedAt.getTime()) / 3_600_000;
      if (Math.abs(actualHours - entry.hours) > 5 / 60) {
        warnings.push({
          rowIndex: entry.rowIndex,
          code: "EXPLICIT_TIME_MISMATCH",
          message: `Hora inicio/fin (${actualHours.toFixed(2)} h) no coincide con horas (${entry.hours.toFixed(2)} h)`,
        });
      }
      slots.push({ rowIndex: entry.rowIndex, startedAt, endedAt, overflow: false });
      cursorMinutes = entry.endTimeMinutes;
      continue;
    }

    const allocated = allocateInWindows(
      input.workDate,
      windows,
      entry.hours,
      cursorMinutes,
    );
    if (allocated.overflow) {
      warnings.push({
        rowIndex: entry.rowIndex,
        code: "SCHEDULE_OVERFLOW",
        message: "Las horas no caben en la jornada; se asignaron tras las 17:00",
      });
    }
    slots.push({
      rowIndex: entry.rowIndex,
      startedAt: allocated.startedAt,
      endedAt: allocated.endedAt,
      overflow: allocated.overflow,
    });
    cursorMinutes = allocated.nextCursor;
  }

  return { slots, warnings };
}
