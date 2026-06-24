import { prisma } from "@/lib/db";
import { parseOrderExecutionMeta } from "./execution";

export interface OrderListMetrics {
  actualHours: number;
  deviationPct: number | null;
  totalUnits: number;
  completedUnits: number;
}

export async function loadOrderMetricsByOrderId(
  orderIds: string[],
): Promise<Map<string, OrderListMetrics>> {
  if (orderIds.length === 0) return new Map();

  const orders = await prisma.productionOrder.findMany({
    where: { id: { in: orderIds } },
    select: {
      id: true,
      hours: true,
      notes: true,
      lines: { select: { units: true, completedUnits: true, taskId: true } },
    },
  });

  const taskIds = [
    ...new Set(
      orders.flatMap((o) => o.lines.map((l) => l.taskId).filter((id): id is string => Boolean(id))),
    ),
  ];

  const entrySums =
    taskIds.length > 0
      ? await prisma.timeEntry.groupBy({
          by: ["taskId"],
          where: { taskId: { in: taskIds } },
          _sum: { hours: true },
        })
      : [];

  const hoursByTask = new Map(
    entrySums.map((e) => [e.taskId!, e._sum.hours ?? 0]),
  );

  const result = new Map<string, OrderListMetrics>();
  for (const order of orders) {
    const { meta } = parseOrderExecutionMeta(order.notes);
    const fromTasks = order.lines.reduce(
      (sum, line) => sum + (line.taskId ? (hoursByTask.get(line.taskId) ?? 0) : 0),
      0,
    );
    const actual = meta.actualHours > 0 ? meta.actualHours : fromTasks;
    const planned = order.hours ?? 0;
    const deviationPct =
      planned > 0 ? Math.round(((actual - planned) / planned) * 1000) / 10 : null;
    result.set(order.id, {
      actualHours: actual,
      deviationPct,
      totalUnits: order.lines.reduce((s, l) => s + l.units, 0),
      completedUnits: order.lines.reduce((s, l) => s + l.completedUnits, 0),
    });
  }
  return result;
}

export async function loadOperatorOrdersForToday(args: {
  naveIds: string[];
  processes: string[];
}) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return prisma.productionOrder.findMany({
    where: {
      naveId: args.naveIds.length === 1 ? args.naveIds[0] : { in: args.naveIds },
      status: { in: ["PEND", "CURSO", "INT", "MULTI"] },
      ...(args.processes.length > 0 ? { process: { in: args.processes } } : {}),
      OR: [
        { scheduledAt: { gte: today, lt: tomorrow } },
        { scheduledAt: null },
      ],
    },
    include: {
      lines: { include: { project: true } },
      nave: { select: { codigo: true, nombre: true } },
    },
    orderBy: [{ status: "asc" }, { scheduledAt: "asc" }],
    take: 50,
  });
}
