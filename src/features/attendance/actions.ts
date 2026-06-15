"use server";

import { revalidatePath } from "next/cache";
import { AttendanceSource, NotificationType, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { emitNotification, resolveNotificationStates } from "@/features/notifications/service";
import {
  assertBreakStartWithinSession,
  assertBreakWithinSession,
  assertNoAttendanceOverlap,
  assertNoBreakOverlap,
  assertNoOpenBreak,
  findOpenAttendanceSession,
} from "./overlap";
import {
  adminCreateAttendanceBreakSchema,
  adminDeleteAttendanceBreakSchema,
  adminDeleteAttendanceSchema,
  adminUpdateAttendanceBreakSchema,
  adminUpsertAttendanceSchema,
  attendanceRangeSchema,
  deleteOwnAttendanceSchema,
  endBreakSchema,
  manualUpsertAttendanceSchema,
  startAttendanceSchema,
  startBreakSchema,
  stopAttendanceSchema,
  updateOwnAttendanceSchema,
} from "./validation";
import { workedSessionMinutes } from "./worked-minutes";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";

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

async function recalculateClosedSessionMinutes(sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      breaks: {
        select: { startedAt: true, endedAt: true, minutes: true },
        orderBy: { startedAt: "asc" },
      },
    },
  });
  if (!session?.endedAt) return;
  const minutes = Math.max(0, workedSessionMinutes(session, session.endedAt));
  await prisma.attendanceSession.update({
    where: { id: sessionId },
    data: { minutes },
  });
}

export async function startAttendance(
  input?: { notes?: string },
): Promise<ActionResult<void>> {
  return runServerAction("attendance.start", async () => {
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
  });
}

export async function stopAttendance(
  input?: { sessionId?: string; notes?: string },
): Promise<ActionResult<void>> {
  return runServerAction("attendance.stop", async () => {
  const ctx = await requireDashboardContext();
  const data = stopAttendanceSchema.parse(input ?? {});
  const session = await prisma.attendanceSession.findFirst({
    where: {
      userId: ctx.userId,
      endedAt: null,
      ...(data.sessionId ? { id: data.sessionId } : {}),
    },
    select: {
      id: true,
      startedAt: true,
      personId: true,
      breaks: {
        where: { endedAt: null },
        select: { id: true, startedAt: true },
      },
    },
  });
  if (!session) throw new Error("No hay fichaje diario activo.");

  const endedAt = new Date();

  const openBreak = session.breaks[0];
  if (openBreak) {
    const breakMinutes = Math.max(
      0,
      Math.round((endedAt.getTime() - openBreak.startedAt.getTime()) / 60000),
    );
    await prisma.attendanceBreak.update({
      where: { id: openBreak.id },
      data: { endedAt, minutes: breakMinutes },
    });
  }

  const breaks = await prisma.attendanceBreak.findMany({
    where: { sessionId: session.id },
    select: { startedAt: true, endedAt: true, minutes: true },
    orderBy: { startedAt: "asc" },
  });

  const minutes = Math.max(
    0,
    workedSessionMinutes(
      { startedAt: session.startedAt, endedAt, breaks },
      endedAt,
    ),
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
  });
}

export async function startBreak(
  input?: { sessionId?: string; notes?: string },
): Promise<ActionResult<void>> {
  return runServerAction("attendance.startBreak", async () => {
    const ctx = await requireDashboardContext();
    const data = startBreakSchema.parse(input ?? {});
    const session = await prisma.attendanceSession.findFirst({
      where: {
        userId: ctx.userId,
        endedAt: null,
        ...(data.sessionId ? { id: data.sessionId } : {}),
      },
      select: { id: true, startedAt: true },
    });
    if (!session) throw new Error("No hay fichaje diario activo.");
    await assertNoOpenBreak(session.id);

    const startedAt = new Date();
    assertBreakStartWithinSession({
      sessionStartedAt: session.startedAt,
      sessionEndedAt: null,
      breakStartedAt: startedAt,
      at: startedAt,
    });

    await prisma.attendanceBreak.create({
      data: {
        sessionId: session.id,
        source: AttendanceSource.BUTTON,
        startedAt,
        notes: data.notes,
      },
    });

    log.info({ userId: ctx.userId, sessionId: session.id }, "attendance break started");
    revalidateAttendancePaths();
  });
}

export async function endBreak(
  input?: { breakId?: string; notes?: string },
): Promise<ActionResult<void>> {
  return runServerAction("attendance.endBreak", async () => {
    const ctx = await requireDashboardContext();
    const data = endBreakSchema.parse(input ?? {});
    const openBreak = await prisma.attendanceBreak.findFirst({
      where: {
        endedAt: null,
        session: { userId: ctx.userId, endedAt: null },
        ...(data.breakId ? { id: data.breakId } : {}),
      },
      select: {
        id: true,
        startedAt: true,
        session: { select: { id: true, startedAt: true, endedAt: true } },
      },
    });
    if (!openBreak) throw new Error("No hay pausa activa.");

    const endedAt = new Date();
    assertBreakWithinSession({
      sessionStartedAt: openBreak.session.startedAt,
      sessionEndedAt: openBreak.session.endedAt,
      breakStartedAt: openBreak.startedAt,
      breakEndedAt: endedAt,
      at: endedAt,
    });
    await assertNoBreakOverlap({
      sessionId: openBreak.session.id,
      startedAt: openBreak.startedAt,
      endedAt,
      excludeBreakId: openBreak.id,
    });

    const minutes = Math.max(
      0,
      Math.round((endedAt.getTime() - openBreak.startedAt.getTime()) / 60000),
    );
    await prisma.attendanceBreak.update({
      where: { id: openBreak.id },
      data: { endedAt, minutes, notes: data.notes },
    });

    log.info({ userId: ctx.userId, breakId: openBreak.id, minutes }, "attendance break ended");
    revalidateAttendancePaths();
  });
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
  const include = {
    breaks: { orderBy: { startedAt: "asc" as const } },
  };
  if (ctx.role === Role.OPERARIO) {
    return prisma.attendanceSession.findMany({
      where: { userId: ctx.userId, startedAt: { gte: start, lte: end } },
      orderBy: { startedAt: "asc" },
      include,
    });
  }
  return prisma.attendanceSession.findMany({
    where: {
      startedAt: { gte: start, lte: end },
      ...(data.personId ? { personId: data.personId } : {}),
    },
    orderBy: { startedAt: "asc" },
    include,
  });
}

export async function createManualAttendanceSession(input: {
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.createManual", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden registrar franjas manuales propias.");
    }
    if (!ctx.personId) {
      throw new Error("Tu usuario no tiene persona vinculada.");
    }
    const data = manualUpsertAttendanceSchema.parse(input);

    const open = await findOpenAttendanceSession(ctx.userId);
    if (open) {
      throw new Error("Cierra el fichaje activo antes de registrar una franja manual.");
    }

    const startedAt = toUtcDateTime(data.date, data.startTime);
    const endedAt = toUtcDateTime(data.date, data.endTime);
    await assertNoAttendanceOverlap({
      userId: ctx.userId,
      startedAt,
      endedAt,
    });
    const minutes = Math.max(
      0,
      workedSessionMinutes({ startedAt, endedAt, breaks: [] }, endedAt),
    );
    await prisma.attendanceSession.create({
      data: {
        userId: ctx.userId,
        personId: ctx.personId,
        source: AttendanceSource.MANUAL,
        startedAt,
        endedAt,
        minutes,
        notes: data.notes,
      },
    });

    const day = data.date;
    await resolveNotificationStates({
      type: NotificationType.ATTENDANCE_INCOMPLETE_DAY,
      scopeKeys: [`attendance-incomplete:${ctx.userId}:${day}`],
    });
    await resolveNotificationStates({
      type: NotificationType.ATTENDANCE_MISSING_WORKDAY,
      scopeKeys: [`attendance-missing:${ctx.userId}:${day}`],
    });

    log.info({ userId: ctx.userId, date: data.date }, "manual attendance session created");
    revalidateAttendancePaths();
  });
}

export async function updateOwnAttendanceSession(input: {
  sessionId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.updateOwn", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden editar sus propios fichajes.");
    }
    const data = updateOwnAttendanceSchema.parse(input);

    const session = await prisma.attendanceSession.findUnique({
      where: { id: data.sessionId },
      select: {
        id: true,
        userId: true,
        source: true,
        endedAt: true,
        startedAt: true,
        breaks: {
          select: { id: true, startedAt: true, endedAt: true },
          orderBy: { startedAt: "asc" },
        },
      },
    });
    if (!session || session.userId !== ctx.userId) {
      throw new Error("Sesión de fichaje no encontrada.");
    }
    if (!session.endedAt) {
      throw new Error("No se puede editar un fichaje abierto.");
    }
    if (
      session.source !== AttendanceSource.MANUAL &&
      session.source !== AttendanceSource.BUTTON
    ) {
      throw new Error("No puedes editar fichajes añadidos por un jefe.");
    }

    const startedAt = toUtcDateTime(data.date, data.startTime);
    const endedAt = toUtcDateTime(data.date, data.endTime);
    await assertNoAttendanceOverlap({
      userId: ctx.userId,
      startedAt,
      endedAt,
      excludeSessionId: session.id,
    });

    for (const breakRow of session.breaks) {
      if (!breakRow.endedAt) {
        throw new Error("No se puede editar un fichaje con pausa abierta.");
      }
      assertBreakWithinSession({
        sessionStartedAt: startedAt,
        sessionEndedAt: endedAt,
        breakStartedAt: breakRow.startedAt,
        breakEndedAt: breakRow.endedAt,
      });
    }

    const breaks = session.breaks.map((b) => ({
      startedAt: b.startedAt,
      endedAt: b.endedAt,
      minutes: b.endedAt
        ? Math.max(0, Math.round((b.endedAt.getTime() - b.startedAt.getTime()) / 60000))
        : null,
    }));
    const minutes = Math.max(
      0,
      workedSessionMinutes({ startedAt, endedAt, breaks }, endedAt),
    );

    await prisma.attendanceSession.update({
      where: { id: session.id },
      data: {
        startedAt,
        endedAt,
        minutes,
        notes: data.notes,
      },
    });

    log.info({ userId: ctx.userId, sessionId: session.id, source: session.source }, "own attendance updated");
    revalidateAttendancePaths();
  });
}

export async function deleteOwnAttendanceSession(input: {
  sessionId: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.deleteOwn", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden eliminar sus fichajes manuales.");
    }
    const data = deleteOwnAttendanceSchema.parse(input);

    const session = await prisma.attendanceSession.findUnique({
      where: { id: data.sessionId },
      select: { id: true, userId: true, source: true },
    });
    if (!session || session.userId !== ctx.userId) {
      throw new Error("Sesión de fichaje no encontrada.");
    }
    if (session.source !== AttendanceSource.MANUAL) {
      throw new Error("Solo puedes eliminar registros manuales.");
    }

    await prisma.attendanceSession.delete({ where: { id: session.id } });
    log.info({ userId: ctx.userId, sessionId: session.id }, "own manual attendance deleted");
    revalidateAttendancePaths();
  });
}

export async function adminUpsertAttendanceSession(input: {
  personId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminUpsert", async () => {
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
  const minutes = Math.max(
    0,
    workedSessionMinutes({ startedAt, endedAt, breaks: [] }, endedAt),
  );
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
  });
}

export async function adminDeleteAttendanceSession(input: {
  sessionId: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminDelete", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = adminDeleteAttendanceSchema.parse(input);
  const session = await prisma.attendanceSession.findUnique({
    where: { id: data.sessionId },
    select: { id: true, userId: true, personId: true, startedAt: true },
  });
  if (!session) throw new Error("Sesión de fichaje no encontrada.");
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
  });
}

export async function adminCreateAttendanceBreak(input: {
  sessionId: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminCreateBreak", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = adminCreateAttendanceBreakSchema.parse(input);

    const session = await prisma.attendanceSession.findUnique({
      where: { id: data.sessionId },
      select: { id: true, startedAt: true, endedAt: true },
    });
    if (!session) throw new Error("Sesión de fichaje no encontrada.");
    if (!session.endedAt) {
      throw new Error("No se pueden añadir pausas cerradas a una sesión abierta.");
    }

    const dateIso = isoDay(session.startedAt);
    const startedAt = toUtcDateTime(dateIso, data.startTime);
    const endedAt = toUtcDateTime(dateIso, data.endTime);
    assertBreakWithinSession({
      sessionStartedAt: session.startedAt,
      sessionEndedAt: session.endedAt,
      breakStartedAt: startedAt,
      breakEndedAt: endedAt,
    });
    await assertNoBreakOverlap({ sessionId: session.id, startedAt, endedAt });

    const minutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
    await prisma.attendanceBreak.create({
      data: {
        sessionId: session.id,
        source: AttendanceSource.ADMIN_EDIT,
        startedAt,
        endedAt,
        minutes,
        notes: data.notes,
      },
    });
    await recalculateClosedSessionMinutes(session.id);
    revalidateAttendancePaths();
  });
}

export async function adminUpdateAttendanceBreak(input: {
  breakId: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminUpdateBreak", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = adminUpdateAttendanceBreakSchema.parse(input);

    const existing = await prisma.attendanceBreak.findUnique({
      where: { id: data.breakId },
      select: {
        id: true,
        sessionId: true,
        session: { select: { startedAt: true, endedAt: true } },
      },
    });
    if (!existing) throw new Error("Pausa no encontrada.");
    if (!existing.session.endedAt) {
      throw new Error("No se puede editar una pausa de una sesión abierta.");
    }

    const dateIso = isoDay(existing.session.startedAt);
    const startedAt = toUtcDateTime(dateIso, data.startTime);
    const endedAt = toUtcDateTime(dateIso, data.endTime);
    assertBreakWithinSession({
      sessionStartedAt: existing.session.startedAt,
      sessionEndedAt: existing.session.endedAt,
      breakStartedAt: startedAt,
      breakEndedAt: endedAt,
    });
    await assertNoBreakOverlap({
      sessionId: existing.sessionId,
      startedAt,
      endedAt,
      excludeBreakId: existing.id,
    });

    const minutes = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000));
    await prisma.attendanceBreak.update({
      where: { id: existing.id },
      data: { startedAt, endedAt, minutes, notes: data.notes },
    });
    await recalculateClosedSessionMinutes(existing.sessionId);
    revalidateAttendancePaths();
  });
}

export async function adminDeleteAttendanceBreak(input: {
  breakId: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminDeleteBreak", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = adminDeleteAttendanceBreakSchema.parse(input);

    const existing = await prisma.attendanceBreak.findUnique({
      where: { id: data.breakId },
      select: { id: true, sessionId: true },
    });
    if (!existing) throw new Error("Pausa no encontrada.");

    await prisma.attendanceBreak.delete({ where: { id: existing.id } });
    await recalculateClosedSessionMinutes(existing.sessionId);
    revalidateAttendancePaths();
  });
}
