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

export function assertBreakStartWithinSession(args: {
  sessionStartedAt: Date;
  sessionEndedAt: Date | null;
  breakStartedAt: Date;
  at?: Date;
}) {
  const sessionEnd = args.sessionEndedAt ?? args.at ?? new Date();
  if (args.breakStartedAt < args.sessionStartedAt) {
    throw new Error("La pausa no puede empezar antes del inicio del fichaje.");
  }
  if (args.breakStartedAt > sessionEnd) {
    throw new Error("La pausa no puede empezar después del fin del fichaje.");
  }
}

export function assertBreakWithinSession(args: {
  sessionStartedAt: Date;
  sessionEndedAt: Date | null;
  breakStartedAt: Date;
  breakEndedAt: Date;
  at?: Date;
}) {
  const sessionEnd = args.sessionEndedAt ?? args.at ?? new Date();
  if (args.breakStartedAt < args.sessionStartedAt) {
    throw new Error("La pausa no puede empezar antes del inicio del fichaje.");
  }
  if (args.breakEndedAt > sessionEnd) {
    throw new Error("La pausa no puede terminar después del fin del fichaje.");
  }
  if (args.breakEndedAt <= args.breakStartedAt) {
    throw new Error("La hora fin de la pausa debe ser posterior a la hora inicio.");
  }
}

export async function assertNoBreakOverlap(args: {
  sessionId: string;
  startedAt: Date;
  endedAt: Date;
  excludeBreakId?: string;
}) {
  const overlap = await prisma.attendanceBreak.findFirst({
    where: {
      sessionId: args.sessionId,
      endedAt: { not: null },
      ...(args.excludeBreakId ? { id: { not: args.excludeBreakId } } : {}),
      startedAt: { lt: args.endedAt },
      AND: [{ endedAt: { gt: args.startedAt } }],
    },
    select: { id: true },
  });
  if (overlap) {
    throw new Error("La pausa se solapa con otra existente en la misma sesión.");
  }
}

export async function assertNoOpenBreak(sessionId: string) {
  const open = await prisma.attendanceBreak.findFirst({
    where: { sessionId, endedAt: null },
    select: { id: true },
  });
  if (open) {
    throw new Error("Ya hay una pausa abierta en esta sesión.");
  }
}

export async function findOpenAttendanceSession(userId: string) {
  return prisma.attendanceSession.findFirst({
    where: { userId, endedAt: null },
    select: { id: true },
  });
}
