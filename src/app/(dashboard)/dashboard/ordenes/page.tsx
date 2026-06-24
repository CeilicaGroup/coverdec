import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { isoWeek, getMondayOf, toUtcDay } from "@/lib/week";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { CreateOrderDialog } from "./create-order-dialog";
import { GenerateWorkOrdersPanel } from "./generate-work-orders-panel";
import { OrdersTable, IN_PROGRESS, type OrderRow } from "./orders-table";

export default async function OrdenesPage() {
  const ctx = await requireDashboardContext();
  const weekStart = getMondayOf(new Date());
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const { year, week } = isoWeek(weekStart);
  const canGenerateOt =
    ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const [orders, projects, processDefs] = await Promise.all([
    prisma.productionOrder.findMany({
      include: {
        project: true,
        nave: { select: { codigo: true, nombre: true } },
        lines: { include: { project: true } },
      },
      orderBy: [{ year: "desc" }, { serial: "desc" }],
      take: 200,
    }),
    prisma.project.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.processDefinition.findMany({
      select: { code: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    number: o.number,
    status: o.status,
    process: o.process,
    hours: o.hours,
    scheduledAt: o.scheduledAt?.toISOString() ?? null,
    scheduledWeek: o.scheduledWeek
      ? toUtcDay(o.scheduledWeek).toISOString().slice(0, 10)
      : null,
    planningGroupId: o.planningGroupId,
    naveLabel: o.nave ? `${o.nave.codigo} · ${o.nave.nombre}` : null,
    projectLabel:
      o.project?.name ??
      (o.lines
        .map((l) => l.project?.name ?? l.clientLabel)
        .filter(Boolean)
        .join(", ") || "—"),
    linesSummary:
      o.lines.length > 0
        ? `${o.lines.length} · ${o.lines.reduce((a, l) => a + l.units, 0)} ud`
        : o.lampLabel ?? "—",
  }));

  const weekOrders = rows.filter((o) => o.scheduledWeek === weekStartIso);
  const kpis = {
    weekTotal: weekOrders.length,
    weekHours: weekOrders.reduce((sum, o) => sum + (o.hours ?? 0), 0),
    inProgress: rows.filter((o) => IN_PROGRESS.has(o.status)).length,
  };

  const processOptions = [
    ...new Set(rows.map((o) => o.process).filter((p): p is string => Boolean(p))),
  ].sort((a, b) => a.localeCompare(b, "es"));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Órdenes de producción"
        description={`${orders.length} órdenes registradas`}
        actions={<CreateOrderDialog projects={projects} processDefs={processDefs} />}
      />
      {canGenerateOt ? (
        <GenerateWorkOrdersPanel initialYear={year} initialWeek={week} />
      ) : null}
      <OrdersTable orders={rows} kpis={kpis} processOptions={processOptions} />
    </div>
  );
}
