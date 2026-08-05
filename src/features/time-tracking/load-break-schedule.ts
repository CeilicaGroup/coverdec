import { prisma } from "@/lib/db";
import {
  buildScheduleOverrides,
  buildWeeklyScheduleFromWorkWindows,
} from "@/features/planning/person-day-capacity";
import type {
  BreakScheduleContext,
  TimeRangeSlice,
} from "@/features/time-tracking/break-handling";

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export async function loadBreakScheduleForRanges(
  personId: string | null,
  ranges: TimeRangeSlice[],
): Promise<BreakScheduleContext | null> {
  if (!personId || ranges.length === 0) return null;
  const start = ranges.reduce(
    (min, range) => (range.startedAt < min ? range.startedAt : min),
    ranges[0]!.startedAt,
  );
  const end = ranges.reduce(
    (max, range) => (range.endedAt > max ? range.endedAt : max),
    ranges[0]!.endedAt,
  );

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      workWindows: {
        select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
      },
      scheduleOverrides: {
        where: {
          date: {
            gte: utcDayStart(start),
            lte: utcDayStart(end),
          },
        },
        select: {
          date: true,
          windows: {
            select: { startMinutes: true, endMinutes: true },
          },
        },
      },
    },
  });

  if (!person || person.workWindows.length === 0) return null;

  return {
    weekly: buildWeeklyScheduleFromWorkWindows(person.workWindows),
    overrides: buildScheduleOverrides(person.scheduleOverrides),
  };
}
