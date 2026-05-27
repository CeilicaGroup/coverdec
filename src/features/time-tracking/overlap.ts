import { prisma } from "@/lib/db";

function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Rejects if the user already has a closed time entry overlapping [startedAt, endedAt). */
export async function assertNoTimeOverlap(
  userId: string,
  startedAt: Date,
  endedAt: Date,
  excludeEntryId?: string,
): Promise<void> {
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      endedAt: { not: null },
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
    select: { id: true, startedAt: true, endedAt: true, hours: true },
  });

  for (const e of entries) {
    const end =
      e.endedAt ??
      new Date(e.startedAt.getTime() + (e.hours ?? 0) * 3_600_000);
    if (rangesOverlap(startedAt, endedAt, e.startedAt, end)) {
      throw new Error(
        "Ya tienes horas registradas en ese horario (puede ser en otra nave).",
      );
    }
  }
}
