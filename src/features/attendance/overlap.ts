import { prisma } from "@/lib/db";

export async function assertNoAttendanceOverlap(args: {
  userId: string;
  startedAt: Date;
  endedAt: Date;
  excludeSessionId?: string;
}) {
  const overlap = await prisma.attendanceSession.findFirst({
    where: {
      userId: args.userId,
      endedAt: { not: null },
      ...(args.excludeSessionId ? { id: { not: args.excludeSessionId } } : {}),
      startedAt: { lt: args.endedAt },
      AND: [{ endedAt: { gt: args.startedAt } }],
    },
    select: { id: true },
  });
  if (overlap) {
    throw new Error("La franja de fichaje se solapa con otra existente.");
  }
}
