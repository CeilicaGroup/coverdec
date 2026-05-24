import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PersonalTeamClient } from "./personal-client";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function PersonalPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const peopleWhere =
    ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION
      ? {}
      : { isActive: true };

  const rangeStart = new Date();
  rangeStart.setUTCHours(0, 0, 0, 0);
  const rangeEnd = new Date(rangeStart.getTime() + 60 * DAY_MS);

  const [peopleRaw, processDefs, usersLinked] = await Promise.all([
    prisma.person.findMany({
      where: peopleWhere,
      include: {
        specialties: true,
        workWindows: true,
        absences: {
          where: { date: { gte: rangeStart, lte: rangeEnd } },
          orderBy: { date: "asc" },
        },
        _count: { select: { assignments: true } },
      },
      orderBy: { iniciales: "asc" },
    }),
    prisma.processDefinition.findMany({
      orderBy: { label: "asc" },
      select: { code: true, label: true },
    }),
    prisma.user.findMany({
      where: { personId: { not: null } },
      select: { personId: true },
    }),
  ]);

  const personIdsWithUser = new Set(
    usersLinked.map((u) => u.personId).filter((id): id is string => id != null),
  );

  const people = peopleRaw.map(({ _count, workWindows, absences, ...p }) => ({
    ...p,
    workWindows,
    absences: absences.map((a) => ({
      date: a.date.toISOString().slice(0, 10),
      hours: a.hours,
      reason: a.reason,
      blockStartMinutes: a.blockStartMinutes,
      blockEndMinutes: a.blockEndMinutes,
    })),
    canHardDelete: _count.assignments === 0 && !personIdsWithUser.has(p.id),
  }));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PersonalTeamClient people={people} processDefs={processDefs} canManage={canManage} />
    </div>
  );
}
