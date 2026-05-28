"use server";

import { revalidatePath } from "next/cache";
import { AttendanceSource, NotificationType, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { emitNotification, resolveNotificationStates } from "@/features/notifications/service";
import { assertNoAttendanceOverlap } from "./overlap";
import {
  adminDeleteAttendanceSchema,
  adminUpsertAttendanceSchema,
  attendanceRangeSchema,
  startAttendanceSchema,
  stopAttendanceSchema,
} from "./validation";

const log = childLogger({ module: "attendance.actions" });
const OPEN_TOO_LONG_MINUTES = 12 * 60;

function revalidateAttendancePaths() {
  revalidatePath("/dashboard/fichaje-diario");
  revalidatePath("/dashboard", "layout");
}

function toUtcDateTime(dateIso: string, time: string): Date {
  return new Date(`${dateIso}T${time}:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMinutes(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

async function emitOutsideWindowAlert(input: {
  userId: string;
  personId: string;
  timestamp: Date;
}) {
  const day = input.timestamp.getUTCDay();
  const weekday = day === 0 ? 7 : day;
  const minutes = utcMinutes(input.timestamp);
  const windows = await prisma.personWorkWindow.findMany({
    where: { personId: input.personId, dayOfWeek: weekday },
    select: { startMinutes: true, endMinutes: true },
  });
  if (windows.length === 0) return;
  const inside = windows.some((w) => minutes >= w.startMinutes && minutes < w.endMinutes);
  if (inside) return;

  const eventDay = isoDay(input.timestamp);
  await emitNotification({
    type: NotificationType.ATTENDANCE_OUTSIDE_WORK_WINDOW,
    title: "Fichaje fuera de horario",
    body: "Se ha detectado un fichaje fuera de la ventana laboral configurada.",
    payload: {
      eventKey: `attendance-outside-window:${input.userId}:${eventDay}`,
      userId: input.userId,
      personId: input.personId,
      dateIso: eventDay,
      atIso: input.timestamp.toISOString(),
    },
    scopeKey: `attendance-outside-window:${input.userId}:${eventDay}`,
  });
}

export async function startAttendance(input?: { notes?: string }) {
  const ctx = await requireDashboardContext();
  const data = startAttendanceSchema.parse(input ?? {});
  if (!ctx.personId) {
    throw new Error("Tu usuario no tiene persona vinculada.");
  }
  const open = await prisma.attendanceSession.findFirst({
    where: { userId: ctx.userId, endedAt: null },
    select: { id: true },
  });
  if (open) {
    throw new Error("Ya tienes un fichaje diario activo.");
  }

  const startedAt = new Date();
  await prisma.attendanceSession.create({
    data: {
      userId: ctx.userId,
      personId: ctx.personId,
      source: AttendanceSource.BUTTON,
      startedAt,
      notes: data.notes,
    },
  });

  await emitOutsideWindowAlert({
    userId: ctx.userId,
    personId: ctx.personId,
    timestamp: startedAt,
  });

  log.info({ userId: ctx.userId }, "attendance started");
  revalidateAttendancePaths();
}

export async function stopAttendance(input?: { sessionId?: string; notes?: string }) {
  const ctx = await requireDashboardContext();
  const data = stopAttendanceSchema.parse(input ?? {});
  const session = await prisma.attendanceSession.findFirst({
    where: {
      userId: ctx.userId,
      endedAt: null,
      ...(data.sessionId ? { id: data.sessionId } : {}),
    },
    select: { id: true, startedAt: true, personId: true },
  });
  if (!session) throw new Error("No hay fichaje diario activo.");

  const endedAt = new Date();
  await assertNoAttendanceOverlap({
    userId: ctx.userId,
    startedAt: session.startedAt,
    endedAt,
    excludeSessionId: session.id,
  });

  const minutes = Math.max(
    1,
    Math.round((endedAt.getTime() - session.startedAt.getTime()) / 60000),
  );
  await prisma.attendanceSession.update({
    where: { id: session.id },
    data: { endedAt, minutes, notes: data.notes },
  });

  if (minutes >= OPEN_TOO_LONG_MINUTES) {
    await emitNotification({
      type: NotificationType.ATTENDANCE_OPEN_TOO_LONG,
      title: "Fichaje abierto demasiadas horas",
      body: "Se ha cerrado una sesión de presencia con duración anómala.",
      payload: {
        eventKey: `attendance-open-too-long:${session.id}`,
        userId: ctx.userId,
        personId: session.personId,
        dateIso: isoDay(session.startedAt),
        sessionId: session.id,
        durationMinutes: minutes,
      },
      scopeKey: `attendance-open-too-long:${session.id}`,
    });
  }

  log.info({ userId: ctx.userId, sessionId: session.id, minutes }, "attendance stopped");
  revalidateAttendancePaths();
}

export async function getAttendanceRange(input: {
  startDate: string;
  endDate: string;
  personId?: string;
}) {
  const ctx = await requireDashboardContext();
  const data = attendanceRangeSchema.parse(input);
  const start = new Date(`${data.startDate}T00:00:00.000Z`);
  const end = new Date(`${data.endDate}T23:59:59.999Z`);
  if (ctx.role === Role.OPERARIO) {
    return prisma.attendanceSession.findMany({
      where: { userId: ctx.userId, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: "asc" },
    });
  }
  return prisma.attendanceSession.findMany({
    where: {
      startedAt: { gte: start, lte: end },
      ...(data.personId ? { personId: data.personId } : {}),
    },
    orderBy: { startedAt: "asc" },
  });
}

export async function adminUpsertAttendanceSession(input: {
  personId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = adminUpsertAttendanceSchema.parse(input);

  const person = await prisma.person.findUnique({
    where: { id: data.personId },
    select: { id: true, user: { select: { id: true } } },
  });
  if (!person?.user?.id) {
    throw new Error("La persona no tiene usuario vinculado.");
  }

  const startedAt = toUtcDateTime(data.date, data.startTime);
  const endedAt = toUtcDateTime(data.date, data.endTime);
  await assertNoAttendanceOverlap({
    userId: person.user.id,
    startedAt,
    endedAt,
  });
  const minutes = Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
  await prisma.attendanceSession.create({
    data: {
      userId: person.user.id,
      personId: data.personId,
      source: AttendanceSource.ADMIN_EDIT,
      startedAt,
      endedAt,
      minutes,
      notes: data.notes,
    },
  });

  await resolveNotificationStates({
    type: NotificationType.ATTENDANCE_INCOMPLETE_DAY,
    scopeKeys: [`attendance-incomplete:${person.user.id}:${data.date}`],
  });
  await resolveNotificationStates({
    type: NotificationType.ATTENDANCE_MISSING_WORKDAY,
    scopeKeys: [`attendance-missing:${person.user.id}:${data.date}`],
  });

  revalidateAttendancePaths();
}

export async function adminDeleteAttendanceSession(input: { sessionId: string }) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = adminDeleteAttendanceSchema.parse(input);
  const session = await prisma.attendanceSession.findUnique({
    where: { id: data.sessionId },
    select: { id: true, userId: true, personId: true, startedAt: true },
  });
  if (!session) return;
  await prisma.attendanceSession.delete({ where: { id: session.id } });
  const day = isoDay(session.startedAt);
  await resolveNotificationStates({
    type: NotificationType.ATTENDANCE_OPEN_TOO_LONG,
    scopeKeys: [`attendance-open-too-long:${session.id}`],
  });
  await emitNotification({
    type: NotificationType.ATTENDANCE_INCOMPLETE_DAY,
    title: "Día con fichaje incompleto",
    body: "Se detectó un día con presencia incompleta tras una edición administrativa.",
    payload: {
      eventKey: `attendance-incomplete:${session.userId}:${day}`,
      userId: session.userId,
      personId: session.personId,
      dateIso: day,
    },
    scopeKey: `attendance-incomplete:${session.userId}:${day}`,
  });
  revalidateAttendancePaths();
}
