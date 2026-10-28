"use server";

import { revalidatePath } from "next/cache";
import { AttendanceSource, NotificationType, Role, type Prisma } from "@/generated/prisma";
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
import {
  applyAttendanceBreakHandling,
  attendanceBreakCreateManyData,
} from "./apply-attendance-break-handling";
import { loadBreakScheduleForRanges } from "@/features/time-tracking/load-break-schedule";
import type { BreakHandling } from "@/features/time-tracking/break-handling";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";
import {
  madridDateIso,
  madridDayBounds,
  madridIsoWeekday,
  madridMinutesOfDay,
  madridWallTimeToInstant,
} from "./madrid-time";

const log = childLogger({ module: "attendance.actions" });
const OPEN_TOO_LONG_MINUTES = 12 * 60;

function revalidateAttendancePaths() {
  revalidatePath("/dashboard/fichaje-diario");
  revalidatePath("/dashboard", "layout");
}

// Fecha + hora tecleadas son hora de Madrid; en BD van como instante real (ver madrid-time.ts).
const toUtcDateTime = madridWallTimeToInstant;
const isoDay = madridDateIso;

/** Presencia de días futuros no tiene sentido (igual que «Mis horas»). Horas posteriores de hoy sí. */
function assertNotFutureDay(dateIso: string) {
  if (dateIso > madridDateIso(new Date())) {
    throw new Error("No se puede registrar presencia en días futuros. Usa la fecha de hoy o anterior.");
  }
}

async function emitOutsideWindowAlert(input: {
  userId: string;
  personId: string;
  timestamp: Date;
}) {
  // Las ventanas laborales son minutos de hora mural de Madrid.
  const weekday = madridIsoWeekday(input.timestamp);
  const minutes = madridMinutesOfDay(input.timestamp);
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

/**
 * Serializa por usuario «¿ya hay una sesión/pausa abierta?» + alta. Sin esto, una doble
 * pulsación (o dos pestañas) pasan ambas la comprobación y crean varias abiertas.
 */
async function lockUserAttendance(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`attendance:${userId}`}))`;
}

async function requireOwnClosedAttendanceSession(userId: string, sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, startedAt: true, endedAt: true },
  });
  if (!session || session.userId !== userId) {
    throw new Error("Sesión de fichaje no encontrada.");
  }
  if (!session.endedAt) {
    throw new Error("No se puede modificar un fichaje abierto.");
  }
  return session;
}

async function requireOwnAttendanceSession(userId: string, sessionId: string) {
  const session = await prisma.attendanceSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, personId: true, startedAt: true },
  });
  if (!session || session.userId !== userId) {
    throw new Error("Sesión de fichaje no encontrada.");
  }
  return session;
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
  const personId = ctx.personId;
  const startedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await lockUserAttendance(tx, ctx.userId);
    const open = await tx.attendanceSession.findFirst({
      where: { userId: ctx.userId, endedAt: null },
      select: { id: true },
    });
    if (open) {
      throw new Error("Ya tienes un fichaje diario activo.");
    }
    // La sesión en vivo va de ahora en adelante: choca con cualquier franja cerrada que acabe después.
    const covering = await tx.attendanceSession.findFirst({
      where: { userId: ctx.userId, endedAt: { gt: startedAt } },
      select: { id: true },
    });
    if (covering) {
      throw new Error("Ya tienes una franja de fichaje registrada que cubre esta hora.");
    }
    await tx.attendanceSession.create({
      data: {
        userId: ctx.userId,
        personId,
        source: AttendanceSource.BUTTON,
        startedAt,
        notes: data.notes,
      },
    });
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
    const session = await prisma.$transaction(async (tx) => {
      await lockUserAttendance(tx, ctx.userId);
      const open = await tx.attendanceSession.findFirst({
        where: {
          userId: ctx.userId,
          endedAt: null,
          ...(data.sessionId ? { id: data.sessionId } : {}),
        },
        select: { id: true, startedAt: true },
      });
      if (!open) throw new Error("No hay fichaje diario activo.");
      await assertNoOpenBreak(open.id, tx);

      const startedAt = new Date();
      assertBreakStartWithinSession({
        sessionStartedAt: open.startedAt,
        sessionEndedAt: null,
        breakStartedAt: startedAt,
        at: startedAt,
      });

      await tx.attendanceBreak.create({
        data: {
          sessionId: open.id,
          source: AttendanceSource.BUTTON,
          startedAt,
          notes: data.notes,
        },
      });
      return open;
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
  const start = madridDayBounds(data.startDate).start;
  const end = madridDayBounds(data.endDate).end;
  const include = {
    breaks: { orderBy: { startedAt: "asc" as const } },
  };
  if (ctx.role === Role.OPERARIO) {
    return prisma.attendanceSession.findMany({
      where: { userId: ctx.userId, startedAt: { gte: start, lt: end } },
      orderBy: { startedAt: "asc" },
      include,
    });
  }
  return prisma.attendanceSession.findMany({
    where: {
      startedAt: { gte: start, lt: end },
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
  breakHandling?: BreakHandling;
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
    assertNotFutureDay(data.date);

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

    const schedule = await loadBreakScheduleForRanges(ctx.personId, [{ startedAt, endedAt }]);
    const handled = applyAttendanceBreakHandling({
      startedAt,
      endedAt,
      dayIso: data.date,
      schedule,
      breakHandling: data.breakHandling,
    });

    await prisma.$transaction(async (tx) => {
      const session = await tx.attendanceSession.create({
        data: {
          userId: ctx.userId,
          personId: ctx.personId!,
          source: AttendanceSource.MANUAL,
          startedAt,
          endedAt,
          minutes: handled.minutes,
          notes: data.notes,
        },
      });
      if (handled.breaks.length > 0) {
        await tx.attendanceBreak.createMany({
          data: attendanceBreakCreateManyData(
            session.id,
            handled.breaks,
            AttendanceSource.MANUAL,
          ),
        });
      }
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

    log.info(
      {
        userId: ctx.userId,
        date: data.date,
        breakHandling: handled.appliedBreakHandling,
        breakCount: handled.breaks.length,
      },
      "manual attendance session created",
    );
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
    assertNotFutureDay(data.date);

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
      throw new Error("Solo los operarios pueden eliminar sus propios fichajes.");
    }
    const data = deleteOwnAttendanceSchema.parse(input);

    const session = await requireOwnAttendanceSession(ctx.userId, data.sessionId);
    await prisma.attendanceSession.delete({ where: { id: session.id } });
    const day = isoDay(session.startedAt);
    await resolveNotificationStates({
      type: NotificationType.ATTENDANCE_OPEN_TOO_LONG,
      scopeKeys: [`attendance-open-too-long:${session.id}`],
    });
    await emitNotification({
      type: NotificationType.ATTENDANCE_INCOMPLETE_DAY,
      title: "Día con fichaje incompleto",
      body: "Se detectó un día con presencia incompleta tras eliminar un fichaje.",
      payload: {
        eventKey: `attendance-incomplete:${session.userId}:${day}`,
        userId: session.userId,
        personId: session.personId,
        dateIso: day,
      },
      scopeKey: `attendance-incomplete:${session.userId}:${day}`,
    });
    log.info({ userId: ctx.userId, sessionId: session.id }, "own attendance deleted");
    revalidateAttendancePaths();
  });
}

export async function createOwnAttendanceBreak(input: {
  sessionId: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.createOwnBreak", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden gestionar pausas de sus fichajes.");
    }
    const data = adminCreateAttendanceBreakSchema.parse(input);
    const session = await requireOwnClosedAttendanceSession(ctx.userId, data.sessionId);

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
        source: AttendanceSource.MANUAL,
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

export async function updateOwnAttendanceBreak(input: {
  breakId: string;
  startTime: string;
  endTime: string;
  notes?: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.updateOwnBreak", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden gestionar pausas de sus fichajes.");
    }
    const data = adminUpdateAttendanceBreakSchema.parse(input);

    const existing = await prisma.attendanceBreak.findUnique({
      where: { id: data.breakId },
      select: {
        id: true,
        sessionId: true,
        session: { select: { userId: true, startedAt: true, endedAt: true } },
      },
    });
    if (!existing || existing.session.userId !== ctx.userId) {
      throw new Error("Pausa no encontrada.");
    }
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

export async function deleteOwnAttendanceBreak(input: {
  breakId: string;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.deleteOwnBreak", async () => {
    const ctx = await requireDashboardContext();
    if (ctx.role !== Role.OPERARIO) {
      throw new Error("Solo los operarios pueden gestionar pausas de sus fichajes.");
    }
    const data = adminDeleteAttendanceBreakSchema.parse(input);

    const existing = await prisma.attendanceBreak.findUnique({
      where: { id: data.breakId },
      select: { id: true, sessionId: true, session: { select: { userId: true } } },
    });
    if (!existing || existing.session.userId !== ctx.userId) {
      throw new Error("Pausa no encontrada.");
    }

    await prisma.attendanceBreak.delete({ where: { id: existing.id } });
    await recalculateClosedSessionMinutes(existing.sessionId);
    revalidateAttendancePaths();
  });
}

export async function adminUpsertAttendanceSession(input: {
  personId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string;
  breakHandling?: BreakHandling;
}): Promise<ActionResult<void>> {
  return runServerAction("attendance.adminUpsert", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = adminUpsertAttendanceSchema.parse(input);
  assertNotFutureDay(data.date);

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

  const schedule = await loadBreakScheduleForRanges(data.personId, [{ startedAt, endedAt }]);
  const handled = applyAttendanceBreakHandling({
    startedAt,
    endedAt,
    dayIso: data.date,
    schedule,
    breakHandling: data.breakHandling,
  });

  await prisma.$transaction(async (tx) => {
    const session = await tx.attendanceSession.create({
      data: {
        userId: person.user!.id,
        personId: data.personId,
        source: AttendanceSource.ADMIN_EDIT,
        startedAt,
        endedAt,
        minutes: handled.minutes,
        notes: data.notes,
      },
    });
    if (handled.breaks.length > 0) {
      await tx.attendanceBreak.createMany({
        data: attendanceBreakCreateManyData(
          session.id,
          handled.breaks,
          AttendanceSource.ADMIN_EDIT,
        ),
      });
    }
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
