import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { CatalogoCatalogClient } from "./catalog-client";
import { ProcessDefinitionsPanel } from "./process-definitions-panel";
import { TypologyNavesPanel } from "./typology-naves-panel";

export default async function CatalogoPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [framesRaw, processDefs, naves, typologyNaves] = await Promise.all([
    prisma.elementType.findMany({
      where: {},
      include: {
        processes: { orderBy: { sequence: "asc" } },
        defaultNave: { select: { id: true, codigo: true, nombre: true } },
        _count: { select: { lamps: true } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.processDefinition.findMany({
      orderBy: { label: "asc" },
      select: {
        code: true,
        label: true,
        waitHours: true,
        bgColor: true,
        fgColor: true,
        borderColor: true,
        canFragment: true,
      },
    }),
    prisma.nave.findMany({
      where: { isActive: true },
      orderBy: { codigo: "asc" },
      select: { id: true, codigo: true, nombre: true },
    }),
    prisma.elementTypologyNave.findMany({
      include: {
        defaultNave: { select: { id: true, codigo: true, nombre: true } },
      },
    }),
  ]);

  const frames = framesRaw.map(({ _count, ...f }) => ({
    ...f,
    lampCount: _count.lamps,
  }));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <ProcessDefinitionsPanel
        processes={processDefs}
        canManage={canManage}
      />
      <TypologyNavesPanel
        rows={typologyNaves.map((row) => ({
          typology: row.typology,
          defaultNaveId: row.defaultNaveId,
          defaultNave: row.defaultNave,
        }))}
        naves={naves}
        canManage={canManage}
      />
      <CatalogoCatalogClient
        frames={frames}
        processDefs={processDefs.map((p) => ({
          code: p.code,
          label: p.label,
          bgColor: p.bgColor,
          fgColor: p.fgColor,
          borderColor: p.borderColor,
        }))}
        naves={naves}
        typologyNaves={typologyNaves.map((row) => ({
          typology: row.typology,
          defaultNaveId: row.defaultNaveId,
          defaultNave: row.defaultNave,
        }))}
        canManage={canManage}
      />
    </div>
  );
}
