import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { PageHeader } from "../../_components/page-header";
import { DailyAttendanceClient } from "./daily-attendance-client";

function attendanceRange(date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start, end };
}

export default async function FichajeDiarioPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const now = new Date();
  const { start, end } = attendanceRange(now);

  const peopleWhere =
    canManage && ctx.naveIds.length > 0
      ? { isActive: true, personNaves: { some: { naveId: { in: ctx.naveIds } } } }
      : { id: ctx.personId ?? "__none__" };

  const [people, sessions, absences, holidays, openSession, openBreak] = await Promise.all([
    prisma.person.findMany({
      where: peopleWhere,
      select: {
        id: true,
        iniciales: true,
        user: { select: { id: true, name: true } },
        workWindows: {
          select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
        },
      },
      orderBy: { iniciales: "asc" },
    }),
    prisma.attendanceSession.findMany({
      where: {
        startedAt: { gte: start, lte: end },
        ...(canManage ? {} : { userId: ctx.userId }),
      },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        userId: true,
        personId: true,
        source: true,
        startedAt: true,
        endedAt: true,
        minutes: true,
        notes: true,
        breaks: {
          orderBy: { startedAt: "asc" },
          select: {
            id: true,
            source: true,
            startedAt: true,
            endedAt: true,
            minutes: true,
            notes: true,
          },
        },
      },
    }),
    prisma.absence.findMany({
      where: {
        AND: [
          { date: { lte: end } },
          { endDate: { gte: start } },
          ...(canManage ? [] : [{ personId: ctx.personId ?? "__none__" }]),
        ],
      },
      select: {
        id: true,
        personId: true,
        date: true,
        endDate: true,
        hours: true,
        reason: true,
        blockStartMinutes: true,
        blockEndMinutes: true,
      },
      orderBy: { date: "asc" },
    }),
    prisma.holiday.findMany({
      select: { id: true, startDate: true, endDate: true, name: true },
      orderBy: { startDate: "asc" },
    }),
    prisma.attendanceSession.findFirst({
      where: { userId: ctx.userId, endedAt: null },
      select: { id: true, startedAt: true },
    }),
    prisma.attendanceBreak.findFirst({
      where: {
        endedAt: null,
        session: { userId: ctx.userId, endedAt: null },
      },
      select: { id: true, startedAt: true, sessionId: true },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Fichaje diario"
        description="Presencia diaria, ausencias (incl. vacaciones personales) y festivos de empresa."
      />
      <DailyAttendanceClient
        canManage={canManage}
        currentUserId={ctx.userId}
        currentPersonId={ctx.personId}
        people={people.map((p) => ({
          id: p.id,
          userId: p.user?.id ?? null,
          name: p.user?.name ?? p.iniciales,
          workWindows: p.workWindows,
        }))}
        sessions={sessions.map((s) => ({
          ...s,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt?.toISOString() ?? null,
          breaks: s.breaks.map((b) => ({
            ...b,
            startedAt: b.startedAt.toISOString(),
            endedAt: b.endedAt?.toISOString() ?? null,
          })),
        }))}
        absences={absences.map((a) => ({
          ...a,
          date: a.date.toISOString().slice(0, 10),
          endDate: a.endDate.toISOString().slice(0, 10),
        }))}
        holidays={holidays.map((h) => ({
          id: h.id,
          startDate: h.startDate.toISOString().slice(0, 10),
          endDate: h.endDate.toISOString().slice(0, 10),
          name: h.name,
        }))}
        openSession={
          openSession
            ? {
                id: openSession.id,
                startedAt: openSession.startedAt.toISOString(),
              }
            : null
        }
        openBreak={
          openBreak
            ? {
                id: openBreak.id,
                sessionId: openBreak.sessionId,
                startedAt: openBreak.startedAt.toISOString(),
              }
            : null
        }
      />
    </div>
  );
}
