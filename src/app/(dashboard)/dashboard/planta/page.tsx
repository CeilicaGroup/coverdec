import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { redirect } from "next/navigation";
import { PageHeader } from "../../_components/page-header";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";
import {
  canExecuteProductionOrders,
  canManageProductionOrders,
} from "@/features/production-orders/permissions";
import { loadOperatorOrdersForToday } from "@/features/production-orders/queries";
import { PlantaTabletPanel } from "./planta-tablet-panel";

export default async function PlantaPage() {
  const ctx = await requireDashboardContext();
  const canAccess =
    ctx.role === Role.OPERARIO ||
    ctx.role === Role.JEFE_PRODUCCION ||
    ctx.role === Role.ADMIN;

  if (!canAccess) {
    redirect("/dashboard");
  }

  let processes: string[] = [];
  if (ctx.role === Role.OPERARIO && ctx.personId) {
    const { prisma } = await import("@/lib/db");
    const person = await prisma.person.findUnique({
      where: { id: ctx.personId },
      select: { specialties: { select: { process: true } } },
    });
    processes = person?.specialties.map((s) => s.process) ?? [];
  }

  const orders = await loadOperatorOrdersForToday({
    naveIds: ctx.naveIds,
    processes,
  });

  const canManage = canManageProductionOrders(ctx.role);
  const canExecute = canExecuteProductionOrders(ctx.role);

  const cards = orders.map((o) => {
    const { meta } = parseOrderExecutionMeta(o.notes);
    const totalUnits = o.lines.reduce((s, l) => s + l.units, 0);
    const completedUnits = o.lines.reduce((s, l) => s + l.completedUnits, 0);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      process: o.process,
      hours: o.hours,
      actualHours: meta.actualHours,
      step: o.step,
      naveLabel: o.nave ? `${o.nave.codigo} · ${o.nave.nombre}` : null,
      projectLabel:
        o.lines
          .map((l) => l.project?.name ?? l.clientLabel)
          .filter(Boolean)
          .join(", ") || "—",
      totalUnits,
      completedUnits,
      canManage,
      canExecute,
      lines: o.lines.map((l) => ({
        id: l.id,
        units: l.units,
        completedUnits: l.completedUnits,
        projectName: l.project?.name ?? l.clientLabel ?? "—",
        ral: l.ral,
      })),
    };
  });

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Planta"
        description="Órdenes de producción para hoy — vista operario"
      />
      <PlantaTabletPanel orders={cards} />
    </div>
  );
}
