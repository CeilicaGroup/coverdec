import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { CatalogoCatalogClient } from "./catalog-client";
import { ProcessDefinitionsPanel } from "./process-definitions-panel";

export default async function CatalogoPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [framesRaw, processDefs] = await Promise.all([
    prisma.frameType.findMany({
      where: {},
      include: {
        processes: { orderBy: { sequence: "asc" } },
        _count: { select: { lamps: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.processDefinition.findMany({
      orderBy: { sequence: "asc" },
      select: {
        code: true,
        label: true,
        sequence: true,
        waitHours: true,
        bgColor: true,
        fgColor: true,
        borderColor: true,
        canFragment: true,
      },
    }),
  ]);

  const frames = framesRaw.map(({ _count, ...f }) => ({
    ...f,
    lampCount: _count.lamps,
  }));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <ProcessDefinitionsPanel processes={processDefs} canManage={canManage} />
      <CatalogoCatalogClient
        frames={frames}
        processDefs={processDefs.map((p) => ({
          code: p.code,
          label: p.label,
          bgColor: p.bgColor,
          fgColor: p.fgColor,
          borderColor: p.borderColor,
        }))}
        canManage={canManage}
      />
    </div>
  );
}
