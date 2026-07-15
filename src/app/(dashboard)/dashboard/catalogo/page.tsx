import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { buildTypologyImageAvailability } from "@/lib/typology-image";
import { buildElementTypeImageAvailability } from "@/lib/element-type-image";
import { CatalogoCatalogClient } from "./catalog-client";
import { ProcessDefinitionsPanel } from "./process-definitions-panel";
import { TypologyNavesPanel } from "./typology-naves-panel";

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams?: Promise<{ archived?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const params = (await searchParams) ?? {};
  const showArchived = params.archived === "1";

  const [framesRaw, processDefs, naves, typologyNaves] = await Promise.all([
    prisma.elementType.findMany({
      where: showArchived ? { isActive: false } : { isActive: true },
      include: {
        processes: { orderBy: { sequence: "asc" }, include: { nave: { select: { id: true, codigo: true, nombre: true } } } },
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
        setupHours: true,
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
      select: {
        typology: true,
        defaultNaveId: true,
        defaultNave: { select: { id: true, codigo: true, nombre: true } },
        imageUpdatedAt: true,
      },
    }),
  ]);

  const frames = framesRaw.map(({ _count, processes, defaultNave, ...f }) => ({
    id: f.id,
    code: f.code,
    name: f.name,
    description: f.description,
    typology: f.typology,
    isActive: f.isActive,
    defaultNaveId: f.defaultNaveId,
    defaultNave,
    processes: processes.map((p) => ({
      id: p.id,
      process: p.process,
      hoursPerUnit: p.hoursPerUnit,
      fixedHours: p.fixedHours,
      naveId: p.naveId,
      nave: p.nave,
    })),
    lampCount: _count.lamps,
    imageUpdatedAt: f.imageUpdatedAt,
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
        typologyImages={buildTypologyImageAvailability(typologyNaves)}
        canManage={canManage}
      />
      <CatalogoCatalogClient
        showArchived={showArchived}
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
        typologyImages={buildTypologyImageAvailability(typologyNaves)}
        elementTypeImages={buildElementTypeImageAvailability(framesRaw)}
        canManage={canManage}
      />
    </div>
  );
}
