import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PersonalTeamClient } from "./personal-client";

export default async function PersonalPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const peopleWhere =
    ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION
      ? {}
      : { isActive: true };

  const [peopleRaw, processDefs, usersLinked] = await Promise.all([
    prisma.person.findMany({
      where: peopleWhere,
      include: {
        specialties: true,
        _count: { select: { assignments: true } },
      },
      orderBy: { iniciales: "asc" },
    }),
    prisma.processDefinition.findMany({
      orderBy: { sequence: "asc" },
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

  const people = peopleRaw.map(({ _count, ...p }) => ({
    ...p,
    canHardDelete: _count.assignments === 0 && !personIdsWithUser.has(p.id),
  }));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PersonalTeamClient people={people} processDefs={processDefs} canManage={canManage} />
    </div>
  );
}
