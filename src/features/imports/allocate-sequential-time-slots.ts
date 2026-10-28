import { combineDateAndTime } from "./excel-date-time";
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

/** Tramo ya ocupado del día (minutos desde medianoche UTC del día del parte). */
export interface BusyInterval {
  startMinutes: number;
  endMinutes: number;
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
  /** Filas que no se pueden colocar sin pisar horas ya registradas. */
  errors: AllocateSlotsWarning[];
}

const DAY_MINUTES = 24 * 60;
/** Lo que no cabe en la jornada se coloca como horas extra a partir de aquí. */
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

const clampMinute = (m: number) => Math.max(0, Math.min(DAY_MINUTES, m));

function hhmm(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function describeBusy(busy: BusyInterval[]): string {
  return busy
    .slice()
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((b) => `${hhmm(b.startMinutes)}–${hhmm(b.endMinutes)}`)
    .join(", ");
}

/**
 * Reparte las filas de un operario y día de forma secuencial (por número de fila).
 * Cada entrada es un tramo continuo que puede saltar huecos no productivos (la comida) pero nunca
 * pisa un tramo ocupado (horas ya registradas ni filas ya colocadas). Lo que no cabe en la jornada
 * va como extra tras las 17:00; si ni así cabe en el día, la fila da error.
 */
export function allocateSequentialTimeSlots(input: {
  workDate: Date;
  entries: TimeSlotInput[];
  weeklyWindows?: WorkWindowMinutes[];
  busy?: BusyInterval[];
}): AllocateSlotsResult {
  const warnings: AllocateSlotsWarning[] = [];
  const errors: AllocateSlotsWarning[] = [];
  const slots: AllocatedTimeSlot[] = [];
  const windows = [...windowsForDay(input.workDate, input.weeklyWindows ?? [])].sort(
    (a, b) => a.startMinutes - b.startMinutes,
  );
  const lastWindowEnd = windows.reduce((max, w) => Math.max(max, w.endMinutes), 0);
  const overtimeStart = Math.max(OVERFLOW_START_MINUTES, lastWindowEnd);

  // Resolución de minuto: productivo = ventana de trabajo o zona de extras.
  const productive = new Array<boolean>(DAY_MINUTES).fill(false);
  for (const w of windows) {
    for (let m = clampMinute(w.startMinutes); m < clampMinute(w.endMinutes); m++) productive[m] = true;
  }
  for (let m = overtimeStart; m < DAY_MINUTES; m++) productive[m] = true;

  const occupied = new Array<boolean>(DAY_MINUTES).fill(false);
  const occupy = (start: number, end: number) => {
    for (let m = clampMinute(Math.floor(start)); m < clampMinute(Math.ceil(end)); m++) occupied[m] = true;
  };
  const existingBusy = input.busy ?? [];
  for (const b of existingBusy) occupy(b.startMinutes, b.endMinutes);
  const busyText = existingBusy.length > 0 ? ` Ya tiene horas registradas ese día: ${describeBusy(existingBusy)}.` : "";

  let cursor = windows[0]?.startMinutes ?? 8 * 60;
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
      const start = entry.startTimeMinutes;
      const end = entry.endTimeMinutes;
      let overlaps = false;
      for (let m = clampMinute(Math.floor(start)); m < clampMinute(Math.ceil(end)); m++) {
        if (occupied[m]) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) {
        errors.push({
          rowIndex: entry.rowIndex,
          code: "SCHEDULE_OVERLAP",
          message: `El tramo ${hhmm(start)}–${hhmm(end)} se solapa con horas ya registradas o importadas de ese operario ese día.${busyText}`,
        });
        continue;
      }
      const actualHours = (end - start) / 60;
      if (Math.abs(actualHours - entry.hours) > 5 / 60) {
        warnings.push({
          rowIndex: entry.rowIndex,
          code: "EXPLICIT_TIME_MISMATCH",
          message: `Hora inicio/fin (${actualHours.toFixed(2)} h) no coincide con horas (${entry.hours.toFixed(2)} h)`,
        });
      }
      occupy(start, end);
      slots.push({
        rowIndex: entry.rowIndex,
        startedAt: combineDateAndTime(input.workDate, start),
        endedAt: combineDateAndTime(input.workDate, end),
        overflow: false,
      });
      cursor = end;
      continue;
    }

    const need = Math.max(1, Math.round(entry.hours * 60));
    let placed: { start: number; end: number } | null = null;
    let from = clampMinute(Math.floor(cursor));
    while (from < DAY_MINUTES && !placed) {
      while (from < DAY_MINUTES && (!productive[from] || occupied[from])) from++;
      if (from >= DAY_MINUTES) break;
      let m = from;
      let got = 0;
      while (m < DAY_MINUTES && got < need && !occupied[m]) {
        if (productive[m]) got++;
        m++;
      }
      if (got === need) placed = { start: from, end: m };
      else from = m; // tropezó con un tramo ocupado (o fin del día): seguir tras él
    }

    if (!placed) {
      errors.push({
        rowIndex: entry.rowIndex,
        code: "SCHEDULE_NO_ROOM",
        message: `No caben ${entry.hours.toFixed(2)} h ese día sin solaparse con otras horas del operario.${busyText}`,
      });
      continue;
    }

    const overflow = placed.end > overtimeStart;
    if (overflow) {
      warnings.push({
        rowIndex: entry.rowIndex,
        code: "SCHEDULE_OVERFLOW",
        message: `Las horas no caben en la jornada; se asignaron como extra tras las ${hhmm(overtimeStart)}`,
      });
    }
    occupy(placed.start, placed.end);
    slots.push({
      rowIndex: entry.rowIndex,
      startedAt: combineDateAndTime(input.workDate, placed.start),
      endedAt: combineDateAndTime(input.workDate, placed.end),
      overflow,
    });
    cursor = placed.end;
  }

  return { slots, warnings, errors };
}
