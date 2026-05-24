import type { WorkWindowMinutes } from "@/features/planning/engine/slots/person-schedule";

/** Minutes of productive time lost inside work windows due to a forbidden [start, end) interval. */
export function minutesBlockedInWindows(
  windows: WorkWindowMinutes[],
  blockStart: number,
  blockEnd: number,
): number {
  if (blockEnd <= blockStart) return 0;
  let lost = 0;
  for (const w of windows) {
    const lo = Math.max(w.startMinutes, blockStart);
    const hi = Math.min(w.endMinutes, blockEnd);
    if (hi > lo) lost += hi - lo;
  }
  return lost;
}
