import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { isoWeek, getMondayOf, toUtcDay } from "@/lib/week";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { CreateOrderDialog } from "./create-order-dialog";
import { GenerateWorkOrdersPanel } from "./generate-work-orders-panel";
import { OrdersPageTabs } from "./orders-page-tabs";
import { IN_PROGRESS, type OrderRow } from "./orders-table";
import type { OrderDetailData } from "./order-detail-drawer";
import type { CalendarOrderBlock } from "./orders-calendar";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";
import {
  canExecuteProductionOrders,
  canManageProductionOrders,
} from "@/features/production-orders/permissions";
import { loadOrderMetricsByOrderId } from "@/features/production-orders/queries";
import { loadNaveOrderKpis } from "@/features/costes/nave-breakdown";
import { OrdersNaveKpis } from "./orders-nave-kpis";

export default async function OrdenesPage() {
  const ctx = await requireDashboardContext();
  const weekStart = getMondayOf(new Date());
  const weekStartIso = weekStart.toISOString().slice(0, 10);
  const { year, week } = isoWeek(weekStart);
  const canGenerateOt =
    ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  const canManage = canManageProductionOrders(ctx.role);
  const canExecute = canExecuteProductionOrders(ctx.role);

  const [orders, projects, processDefs, elementTypes, naves, naveKpis] = await Promise.all([
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
    prisma.elementType.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.nave.findMany({
      where: { isActive: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
    loadNaveOrderKpis(weekStart),
  ]);

  const metricsById = await loadOrderMetricsByOrderId(orders.map((o) => o.id));

  const rows: OrderRow[] = orders.map((o) => {
    const metrics = metricsById.get(o.id);
    return {
      id: o.id,
      number: o.number,
      kind: o.kind,
      status: o.status,
      process: o.process,
      hours: o.hours,
      actualHours: metrics?.actualHours ?? 0,
      deviationPct: metrics?.deviationPct ?? null,
      totalUnits: metrics?.totalUnits ?? o.lines.reduce((a, l) => a + l.units, 0),
      completedUnits: metrics?.completedUnits ?? o.lines.reduce((a, l) => a + l.completedUnits, 0),
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
    };
  });

  const weekOrders = rows.filter((o) => o.scheduledWeek === weekStartIso);
  const weekDeviations = weekOrders
    .map((o) => o.deviationPct)
    .filter((d): d is number => d != null);
  const kpis = {
    weekTotal: weekOrders.length,
    weekHours: weekOrders.reduce((sum, o) => sum + (o.hours ?? 0), 0),
    inProgress: rows.filter((o) => IN_PROGRESS.has(o.status)).length,
    avgDeviationPct:
      weekDeviations.length > 0
        ? Math.round(
            (weekDeviations.reduce((a, b) => a + b, 0) / weekDeviations.length) * 10,
          ) / 10
        : null,
  };

  const processOptions = [
    ...new Set(rows.map((o) => o.process).filter((p): p is string => Boolean(p))),
  ].sort((a, b) => a.localeCompare(b, "es"));

  const calendarOrders: CalendarOrderBlock[] = rows
    .filter((o) => o.scheduledAt)
    .map((o) => ({
      id: o.id,
      number: o.number,
      process: o.process,
      hours: o.hours,
      scheduledAt: o.scheduledAt,
      status: o.status,
    }));

  const orderDetailsById: Record<string, OrderDetailData> = {};
  for (const o of orders) {
    const row = rows.find((r) => r.id === o.id)!;
    const { userNotes, meta } = parseOrderExecutionMeta(o.notes);
    orderDetailsById[o.id] = {
      id: o.id,
      number: o.number,
      status: o.status,
      process: o.process,
      hours: o.hours,
      actualHours: row.actualHours || meta.actualHours,
      step: o.step,
      scheduledAt: row.scheduledAt,
      scheduledWeek: row.scheduledWeek,
      planningGroupId: o.planningGroupId,
      naveLabel: row.naveLabel,
      userNotes,
      totalUnits: row.totalUnits,
      completedUnits: row.completedUnits,
      canManage,
      canExecute,
      lines: o.lines.map((l) => ({
        id: l.id,
        taskId: l.taskId,
        projectName: l.project?.name ?? l.clientLabel ?? "—",
        units: l.units,
        completedUnits: l.completedUnits,
        ral: l.ral,
      })),
    };
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Órdenes de producción"
        description={`${orders.length} órdenes registradas`}
        actions={
          <CreateOrderDialog
            projects={projects}
            processDefs={processDefs}
            elementTypes={elementTypes}
            naves={naves}
          />
        }
      />
      {canGenerateOt ? (
        <GenerateWorkOrdersPanel initialYear={year} initialWeek={week} />
      ) : null}
      <OrdersNaveKpis rows={naveKpis} />
      <OrdersPageTabs
        orders={rows}
        kpis={kpis}
        processOptions={processOptions}
        calendarOrders={calendarOrders}
        orderDetailsById={orderDetailsById}
      />
    </div>
  );
}
