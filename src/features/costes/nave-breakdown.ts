import { ProductionOrderStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf, toUtcDay } from "@/lib/week";
import type { NaveKpiRow } from "@/app/(dashboard)/dashboard/ordenes/orders-nave-kpis";

const IN_PROGRESS = new Set<ProductionOrderStatus>([
  ProductionOrderStatus.CURSO,
  ProductionOrderStatus.INT,
  ProductionOrderStatus.MULTI,
]);

export interface NaveCostRow {
  codigo: string;
  nombre: string;
  hours: number;
  hourlyRate: number;
  cost: number;
}

export async function loadNaveOrderKpis(weekStart: Date): Promise<NaveKpiRow[]> {
  const weekStartIso = getMondayOf(weekStart).toISOString().slice(0, 10);
  const naves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true },
  });

  const orders = await prisma.productionOrder.findMany({
    where: { naveId: { in: naves.map((n) => n.id) } },
    select: {
      naveId: true,
      hours: true,
      status: true,
      scheduledWeek: true,
    },
  });

  return naves.map((nave) => {
    const naveOrders = orders.filter((o) => o.naveId === nave.id);
    const weekOrders = naveOrders.filter(
      (o) =>
        o.scheduledWeek &&
        toUtcDay(o.scheduledWeek).toISOString().slice(0, 10) === weekStartIso,
    );
    return {
      codigo: nave.codigo,
      nombre: nave.nombre,
      weekOps: weekOrders.length,
      weekHours: weekOrders.reduce((s, o) => s + (o.hours ?? 0), 0),
      inProgress: naveOrders.filter((o) => IN_PROGRESS.has(o.status)).length,
    };
  });
}

export async function loadNaveCostBreakdown(args: {
  weekStart: Date;
}): Promise<NaveCostRow[]> {
  const weekMon = getMondayOf(args.weekStart);
  const weekFri = new Date(weekMon.getTime() + 4 * 86400000);

  const naves = await prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true, codigo: true, nombre: true, hourlyRate: true },
  });

  const assignments = await prisma.planningAssignment.findMany({
    where: {
      date: { gte: weekMon, lte: weekFri },
      task: { naveId: { in: naves.map((n) => n.id) } },
    },
    select: { hours: true, task: { select: { naveId: true } } },
  });

  const entries = await prisma.timeEntry.findMany({
    where: {
      startedAt: { gte: weekMon, lte: new Date(weekFri.getTime() + 86400000) },
      task: { naveId: { in: naves.map((n) => n.id) } },
    },
    select: { hours: true, task: { select: { naveId: true } } },
  });

  return naves.map((nave) => {
    const planHours = assignments
      .filter((a) => a.task.naveId === nave.id)
      .reduce((s, a) => s + a.hours, 0);
    const realHours = entries
      .filter((e) => e.task?.naveId === nave.id)
      .reduce((s, e) => s + (e.hours ?? 0), 0);
    const hours = realHours > 0 ? realHours : planHours;
    const hourlyRate = nave.hourlyRate ? Number(nave.hourlyRate) : 38;
    return {
      codigo: nave.codigo,
      nombre: nave.nombre,
      hours,
      hourlyRate,
      cost: Math.round(hours * hourlyRate * 100) / 100,
    };
  });
}
