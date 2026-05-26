import {
  AFTERNOON_END,
  AFTERNOON_START,
  MORNING_END,
  MORNING_START,
} from "./types";

const MORNING_DURATION = MORNING_END - MORNING_START;
const AFTERNOON_DURATION = AFTERNOON_END - AFTERNOON_START;
/** Slots productivos por jornada (mañana + tarde). */
export const PRODUCTIVE_SLOTS_PER_DAY = MORNING_DURATION + AFTERNOON_DURATION;
const FULL_DAY = PRODUCTIVE_SLOTS_PER_DAY;

/**
 * Converts a productive slot used as a START position into wall-clock decimal hour.
 * slot 6.0 as start = 15:00 (beginning of afternoon).
 */
export function slotToHour(slot: number): number {
  const clamped = Math.max(0, Math.min(FULL_DAY, slot));
  if (clamped < MORNING_DURATION) {
    return MORNING_START + clamped;
  }
  return AFTERNOON_START + (clamped - MORNING_DURATION);
}

/**
 * Converts a productive slot used as an END position into wall-clock decimal hour.
 * slot 6.0 as end = 14:00 (end of morning, before the lunch break).
 */
export function slotEndToHour(slot: number): number {
  const clamped = Math.max(0, Math.min(FULL_DAY, slot));
  if (clamped <= MORNING_DURATION) {
    return MORNING_START + clamped;
  }
  return AFTERNOON_START + (clamped - MORNING_DURATION);
}

function _hourToLabel(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function slotToLabel(slot: number): string {
  return _hourToLabel(slotToHour(slot));
}

export function slotEndLabel(slot: number): string {
  return _hourToLabel(slotEndToHour(slot));
}

export function rangeLabel(start: number, end: number): string {
  return `${slotToLabel(start)}–${slotEndLabel(end)}`;
}
