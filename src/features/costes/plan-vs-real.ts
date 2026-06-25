import {
  ProductionOrderKind,
  ProductionOrderStatus,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf, toUtcDay } from "@/lib/week";
import { parseOrderExecutionMeta } from "@/features/production-orders/execution";
import { computeMaterialCostForUnits } from "./bom-cost";

export interface ProjectPlanVsRealRow {
  projectId: string;
  projectName: string;
  isBillable: boolean;
  planMo: number;
  realMo: number;
  planMaterial: number;
  realMaterial: number;
}

export interface OrtCostRow {
  orderId: string;
  number: string;
  parentNumber: string | null;
  hours: number;
  cost: number;
}

export interface WeeklyPlanVsRealSummary {
  projects: ProjectPlanVsRealRow[];
  ortOrders: OrtCostRow[];
}

const STANDARD_KINDS = new Set<ProductionOrderKind>([
  ProductionOrderKind.PROYECTO,
  ProductionOrderKind.STOCK,
]);

function weekRange(weekStart: Date) {
  const weekMon = getMondayOf(weekStart);
  const weekFri = new Date(weekMon.getTime() + 4 * 86400000);
  const weekEnd = new Date(weekFri.getTime() + 86400000);
  return { weekMon, weekFri, weekEnd, weekStartIso: weekMon.toISOString().slice(0, 10) };
}

function allocateByUnits<T extends { units: number }>(
  items: T[],
  total: number,
): Map<T, number> {
  const result = new Map<T, number>();
  const weight = items.reduce((s, item) => s + item.units, 0);
  if (weight <= 0 || total <= 0) return result;
  let assigned = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const share =
      i === items.length - 1
        ? total - assigned
        : Math.round(((item.units / weight) * total + Number.EPSILON) * 100) / 100;
    result.set(item, share);
    assigned += share;
  }
  return result;
}

export async function loadWeeklyProjectPlanVsReal(
  weekStart: Date,
): Promise<WeeklyPlanVsRealSummary> {
  const { weekMon, weekEnd, weekStartIso } = weekRange(weekStart);

  const [entries, orders, bomByElementType] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        startedAt: { gte: weekMon, lt: weekEnd },
        projectId: { not: null },
      },
      select: {
        hours: true,
        projectId: true,
        user: { select: { person: { select: { hourlyRate: true } } } },
        project: { select: { id: true, name: true, isBillable: true } },
      },
    }),
    prisma.productionOrder.findMany({
      where: {
        OR: [
          {
            scheduledWeek: {
              gte: weekMon,
              lt: new Date(weekMon.getTime() + 7 * 86400000),
            },
          },
          {
            scheduledAt: { gte: weekMon, lt: weekEnd },
          },
        ],
        status: { not: ProductionOrderStatus.CERR },
      },
      select: {
        id: true,
        number: true,
        kind: true,
        hours: true,
        notes: true,
        elementTypeId: true,
        nave: { select: { hourlyRate: true } },
        parentOrder: { select: { number: true } },
        lines: {
          where: { lineStatus: "ACTIVE" },
          select: { projectId: true, units: true, project: { select: { name: true, isBillable: true } } },
        },
      },
    }),
    prisma.bomComponent.findMany({
      select: { elementTypeId: true, quantity: true, unitCost: true },
    }),
  ]);

  const bomMap = new Map<string, Array<{ quantity: number; unitCost: number }>>();
  for (const row of bomByElementType) {
    const list = bomMap.get(row.elementTypeId) ?? [];
    list.push({ quantity: row.quantity, unitCost: Number(row.unitCost) });
    bomMap.set(row.elementTypeId, list);
  }

  const projects = new Map<string, ProjectPlanVsRealRow>();

  for (const entry of entries) {
    if (!entry.projectId || !entry.project) continue;
    const rate = Number(entry.user.person?.hourlyRate ?? 38);
    const row = projects.get(entry.projectId) ?? {
      projectId: entry.projectId,
      projectName: entry.project.name,
      isBillable: entry.project.isBillable,
      planMo: 0,
      realMo: 0,
      planMaterial: 0,
      realMaterial: 0,
    };
    row.realMo += (entry.hours ?? 0) * rate;
    projects.set(entry.projectId, row);
  }

  const ortOrders: OrtCostRow[] = [];

  for (const order of orders) {
    if (order.kind === ProductionOrderKind.ORT) {
      const { meta } = parseOrderExecutionMeta(order.notes);
      const hours = meta.actualHours > 0 ? meta.actualHours : (order.hours ?? 0);
      const rate = order.nave?.hourlyRate ? Number(order.nave.hourlyRate) : 38;
      ortOrders.push({
        orderId: order.id,
        number: order.number,
        parentNumber: order.parentOrder?.number ?? null,
        hours,
        cost: Math.round(hours * rate * 100) / 100,
      });
      continue;
    }

    if (!STANDARD_KINDS.has(order.kind)) continue;

    const activeLines = order.lines.filter((l) => l.projectId);
    if (activeLines.length === 0) continue;

    const naveRate = order.nave?.hourlyRate ? Number(order.nave.hourlyRate) : 38;
    const planMoTotal = (order.hours ?? 0) * naveRate;
    const moShares = allocateByUnits(activeLines, planMoTotal);

    const bom = order.elementTypeId ? bomMap.get(order.elementTypeId) ?? [] : [];
    for (const line of activeLines) {
      if (!line.projectId) continue;
      const projectName = line.project?.name ?? "—";
      const row = projects.get(line.projectId) ?? {
        projectId: line.projectId,
        projectName,
        isBillable: line.project?.isBillable ?? true,
        planMo: 0,
        realMo: 0,
        planMaterial: 0,
        realMaterial: 0,
      };
      row.planMo += moShares.get(line) ?? 0;
      const material = computeMaterialCostForUnits(bom, line.units);
      row.planMaterial += material;
      row.realMaterial += material;
      projects.set(line.projectId, row);
    }
  }

  return {
    projects: [...projects.values()].sort((a, b) =>
      a.projectName.localeCompare(b.projectName, "es"),
    ),
    ortOrders,
  };
}

export async function loadProjectPlanVsReal(projectId: string): Promise<{
  planMo: number;
  realMo: number;
  planMaterial: number;
  realMaterial: number;
  ortCost: number;
}> {
  const [orders, entries, bomRows, ortOrders] = await Promise.all([
    prisma.productionOrder.findMany({
      where: {
        kind: { in: [ProductionOrderKind.PROYECTO, ProductionOrderKind.STOCK] },
        lines: { some: { projectId, lineStatus: "ACTIVE" } },
      },
      select: {
        hours: true,
        elementTypeId: true,
        nave: { select: { hourlyRate: true } },
        lines: {
          where: { projectId, lineStatus: "ACTIVE" },
          select: { units: true },
        },
      },
    }),
    prisma.timeEntry.findMany({
      where: { projectId },
      select: {
        hours: true,
        user: { select: { person: { select: { hourlyRate: true } } } },
      },
    }),
    prisma.bomComponent.findMany({
      select: { elementTypeId: true, quantity: true, unitCost: true },
    }),
    prisma.productionOrder.findMany({
      where: {
        kind: ProductionOrderKind.ORT,
        lines: { some: { projectId } },
      },
      select: { hours: true, notes: true, nave: { select: { hourlyRate: true } } },
    }),
  ]);

  const bomMap = new Map<string, Array<{ quantity: number; unitCost: number }>>();
  for (const row of bomRows) {
    const list = bomMap.get(row.elementTypeId) ?? [];
    list.push({ quantity: row.quantity, unitCost: Number(row.unitCost) });
    bomMap.set(row.elementTypeId, list);
  }

  let planMo = 0;
  let planMaterial = 0;
  for (const order of orders) {
    const projectUnits = order.lines.reduce((s, l) => s + l.units, 0);
    const totalUnits = order.lines.reduce((s, l) => s + l.units, 0);
    const share = totalUnits > 0 ? projectUnits / totalUnits : 0;
    const naveRate = order.nave?.hourlyRate ? Number(order.nave.hourlyRate) : 38;
    planMo += (order.hours ?? 0) * naveRate * share;
    const bom = order.elementTypeId ? bomMap.get(order.elementTypeId) ?? [] : [];
    planMaterial += computeMaterialCostForUnits(bom, projectUnits);
  }

  const realMo = entries.reduce(
    (s, e) => s + (e.hours ?? 0) * Number(e.user.person?.hourlyRate ?? 38),
    0,
  );

  const ortCost = ortOrders.reduce((s, order) => {
    const { meta } = parseOrderExecutionMeta(order.notes);
    const hours = meta.actualHours > 0 ? meta.actualHours : (order.hours ?? 0);
    const rate = order.nave?.hourlyRate ? Number(order.nave.hourlyRate) : 38;
    return s + hours * rate;
  }, 0);

  return {
    planMo: Math.round(planMo * 100) / 100,
    realMo: Math.round(realMo * 100) / 100,
    planMaterial: Math.round(planMaterial * 100) / 100,
    realMaterial: Math.round(planMaterial * 100) / 100,
    ortCost: Math.round(ortCost * 100) / 100,
  };
}

export interface OrderDeviationRow {
  id: string;
  number: string;
  plannedHours: number;
  actualHours: number;
  deviationPct: number;
}

export async function loadTopOrderDeviations(args: {
  weekStart: Date;
  limit?: number;
}): Promise<OrderDeviationRow[]> {
  const { weekStartIso } = weekRange(args.weekStart);
  const orders = await prisma.productionOrder.findMany({
    where: {
      kind: ProductionOrderKind.PROYECTO,
      scheduledWeek: {
        gte: getMondayOf(args.weekStart),
        lt: new Date(getMondayOf(args.weekStart).getTime() + 7 * 86400000),
      },
      hours: { gt: 0 },
    },
    select: { id: true, number: true, hours: true, notes: true, scheduledWeek: true },
    take: 100,
  });

  const rows: OrderDeviationRow[] = [];
  for (const order of orders) {
    if (
      !order.scheduledWeek ||
      toUtcDay(order.scheduledWeek).toISOString().slice(0, 10) !== weekStartIso
    ) {
      continue;
    }
    const planned = order.hours ?? 0;
    if (planned <= 0) continue;
    const { meta } = parseOrderExecutionMeta(order.notes);
    const actual = meta.actualHours;
    if (actual <= 0) continue;
    const deviationPct = Math.round(((actual - planned) / planned) * 1000) / 10;
    rows.push({
      id: order.id,
      number: order.number,
      plannedHours: planned,
      actualHours: actual,
      deviationPct,
    });
  }

  return rows
    .sort((a, b) => Math.abs(b.deviationPct) - Math.abs(a.deviationPct))
    .slice(0, args.limit ?? 5);
}
