import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { CatalogoCatalogClient } from "./catalog-client";

export default async function CatalogoPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [frames, processDefs] = await Promise.all([
    prisma.frameType.findMany({
      where: {},
      include: { processes: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.processDefinition.findMany({
      orderBy: { sequence: "asc" },
      select: { code: true, label: true },
    }),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <CatalogoCatalogClient
        frames={frames}
        processDefs={processDefs}
        canManage={canManage}
      />
    </div>
  );
}
