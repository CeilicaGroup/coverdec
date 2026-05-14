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

  const [people, processDefs] = await Promise.all([
    prisma.person.findMany({
      where: peopleWhere,
      include: { specialties: true },
      orderBy: { iniciales: "asc" },
    }),
    prisma.processDefinition.findMany({
      orderBy: { sequence: "asc" },
      select: { code: true, label: true },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PersonalTeamClient people={people} processDefs={processDefs} canManage={canManage} />
    </div>
  );
}
