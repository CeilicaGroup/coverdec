import type { AttendanceSource } from "@/generated/prisma";
import {
  scheduleBreakWindowsForDate,
  type BreakHandling,
  type BreakOverlapSummary,
  type BreakScheduleContext,
  type TimeRangeSlice,
} from "@/features/time-tracking/break-handling";
import { workedSessionMinutes } from "./worked-minutes";

/**
 * Attendance stores wall-clock times as UTC (`YYYY-MM-DDTHH:mm:00.000Z`).
 * Break gaps from the person schedule use the same encoding so 08–17 vs 14–15 align.
 */
function atWallClockUtc(dayIso: string, minutes: number): Date {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return new Date(
    `${dayIso}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`,
  );
}

function intersectRange(a: TimeRangeSlice, b: TimeRangeSlice): TimeRangeSlice | null {
  const start = Math.max(a.startedAt.getTime(), b.startedAt.getTime());
  const end = Math.min(a.endedAt.getTime(), b.endedAt.getTime());
  if (end <= start) return null;
  return { startedAt: new Date(start), endedAt: new Date(end) };
}

export function summarizeAttendanceBreakOverlap(
  range: TimeRangeSlice,
  dayIso: string,
  schedule: BreakScheduleContext | null,
): BreakOverlapSummary {
  if (!schedule) {
    return { hasOverlap: false, overlapMinutes: 0, overlapSegments: [] };
  }

  const overlapSegments: TimeRangeSlice[] = [];
  for (const breakWindow of scheduleBreakWindowsForDate(dayIso, schedule)) {
    const dayBreakSlice = {
      startedAt: atWallClockUtc(dayIso, breakWindow.startMinutes),
      endedAt: atWallClockUtc(dayIso, breakWindow.endMinutes),
    };
    const overlap = intersectRange(range, dayBreakSlice);
    if (overlap) overlapSegments.push(overlap);
  }

  const overlapMinutes = overlapSegments.reduce(
    (sum, segment) =>
      sum + (segment.endedAt.getTime() - segment.startedAt.getTime()) / 60000,
    0,
  );

  return {
    hasOverlap: overlapSegments.length > 0,
    overlapMinutes: Math.round(overlapMinutes),
    overlapSegments,
  };
}

export interface AttendanceBreakHandlingResult {
  overlap: BreakOverlapSummary;
  breaks: Array<{ startedAt: Date; endedAt: Date; minutes: number }>;
  minutes: number;
  appliedBreakHandling?: BreakHandling;
}

export function applyAttendanceBreakHandling(args: {
  startedAt: Date;
  endedAt: Date;
  dayIso: string;
  schedule: BreakScheduleContext | null;
  breakHandling?: BreakHandling;
}): AttendanceBreakHandlingResult {
  const range = { startedAt: args.startedAt, endedAt: args.endedAt };
  const overlap = summarizeAttendanceBreakOverlap(range, args.dayIso, args.schedule);

  if (!overlap.hasOverlap) {
    return {
      overlap,
      breaks: [],
      minutes: Math.max(
        0,
        workedSessionMinutes({ startedAt: args.startedAt, endedAt: args.endedAt, breaks: [] }, args.endedAt),
      ),
    };
  }

  if (!args.breakHandling) {
    throw new Error(
      "El fichaje cruza una franja de descanso. Indica si fue trabajo extra o descanso.",
    );
  }

  if (args.breakHandling === "worked_extra") {
    return {
      overlap,
      breaks: [],
      minutes: Math.max(
        0,
        workedSessionMinutes({ startedAt: args.startedAt, endedAt: args.endedAt, breaks: [] }, args.endedAt),
      ),
      appliedBreakHandling: "worked_extra",
    };
  }

  const breaks = overlap.overlapSegments.map((segment) => ({
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    minutes: Math.max(
      0,
      Math.round((segment.endedAt.getTime() - segment.startedAt.getTime()) / 60000),
    ),
  }));

  const minutes = Math.max(
    0,
    workedSessionMinutes(
      {
        startedAt: args.startedAt,
        endedAt: args.endedAt,
        breaks: breaks.map((row) => ({
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          minutes: row.minutes,
        })),
      },
      args.endedAt,
    ),
  );

  if (minutes <= 0) {
    throw new Error("El rango indicado corresponde solo a descanso. Ajusta el horario.");
  }

  return {
    overlap,
    breaks,
    minutes,
    appliedBreakHandling: "took_break",
  };
}

export function attendanceBreakCreateManyData(
  sessionId: string,
  breaks: AttendanceBreakHandlingResult["breaks"],
  source: AttendanceSource,
) {
  return breaks.map((row) => ({
    sessionId,
    source,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    minutes: row.minutes,
  }));
}
