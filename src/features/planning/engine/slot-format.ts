import {
  AFTERNOON_END,
  AFTERNOON_START,
  MORNING_END,
  MORNING_START,
} from "./types";

const MORNING_DURATION = MORNING_END - MORNING_START;
const AFTERNOON_DURATION = AFTERNOON_END - AFTERNOON_START;
const FULL_DAY = MORNING_DURATION + AFTERNOON_DURATION;

/**
 * Converts a productive slot (0..FULL_DAY) into the real wall-clock decimal hour.
 * Slots 0–6 → 08:00–14:00. Slots 6–8 → 15:00–17:00 (with 1h break implicit).
 */
export function slotToHour(slot: number): number {
  const clamped = Math.max(0, Math.min(FULL_DAY, slot));
  if (clamped < MORNING_DURATION) {
    return MORNING_START + clamped;
  }
  return AFTERNOON_START + (clamped - MORNING_DURATION);
}

export function slotToLabel(slot: number): string {
  const hour = slotToHour(slot);
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function rangeLabel(start: number, end: number): string {
  return `${slotToLabel(start)}–${slotToLabel(end)}`;
}
