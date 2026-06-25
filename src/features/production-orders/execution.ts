import {
  ProductionOrderLineStatus,
  ProductionOrderStatus,
  TimeEntrySource,
  type Prisma,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";

const EXEC_META_START = "\n---EXEC---\n";
const EXEC_META_END = "\n---END EXEC---\n";

export interface OrderExecutionMeta {
  actualHours: number;
}

export interface ProductionOrderLineForDistribution {
  id: string;
  taskId: string | null;
  projectId: string | null;
  units: number;
  ral: string | null;
}

export function parseOrderExecutionMeta(notes: string | null): {
  userNotes: string;
  meta: OrderExecutionMeta;
} {
  if (!notes) return { userNotes: "", meta: { actualHours: 0 } };
  const start = notes.indexOf(EXEC_META_START);
  if (start === -1) return { userNotes: notes, meta: { actualHours: 0 } };
  const end = notes.indexOf(EXEC_META_END, start);
  if (end === -1) return { userNotes: notes.slice(0, start).trim(), meta: { actualHours: 0 } };
  const json = notes.slice(start + EXEC_META_START.length, end).trim();
  let meta: OrderExecutionMeta = { actualHours: 0 };
  try {
    const parsed = JSON.parse(json) as Partial<OrderExecutionMeta>;
    meta = { actualHours: parsed.actualHours ?? 0 };
  } catch {
    meta = { actualHours: 0 };
  }
  const userNotes = (notes.slice(0, start) + notes.slice(end + EXEC_META_END.length)).trim();
  return { userNotes, meta };
}

export function serializeOrderNotes(
  userNotes: string,
  meta: OrderExecutionMeta,
): string {
  const base = userNotes.trim();
  const block = `${EXEC_META_START}${JSON.stringify(meta)}${EXEC_META_END}`;
  return base ? `${base}${block}` : block.trim();
}

const PAINT_PROCESS_CODES = new Set(["PINTURA", "PINT"]);

export function eligibleLinesForHourDistribution(
  lines: ProductionOrderLineForDistribution[],
  process: string | null,
): ProductionOrderLineForDistribution[] {
  const active = lines.filter((l) => l.units > 0);
  if (process && PAINT_PROCESS_CODES.has(process.toUpperCase())) {
    return active.filter((l) => Boolean(l.ral?.trim()));
  }
  return active;
}

/** Reparte horas totales proporcionalmente por unidades de línea. */
export function distributeHoursToLines(
  lines: ProductionOrderLineForDistribution[],
  totalHours: number,
): Map<string, number> {
  const result = new Map<string, number>();
  if (totalHours <= 0 || lines.length === 0) return result;

  const weightSum = lines.reduce((sum, l) => sum + l.units, 0);
  if (weightSum <= 0) return result;

  let assigned = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === lines.length - 1) {
      result.set(line.id, Math.round((totalHours - assigned) * 100) / 100);
    } else {
      const share = Math.round(((totalHours * line.units) / weightSum) * 100) / 100;
      result.set(line.id, share);
      assigned += share;
    }
  }
  return result;
}

export function assertOrderTransition(
  current: ProductionOrderStatus,
  allowed: ProductionOrderStatus[],
): void {
  if (!allowed.includes(current)) {
    throw new Error(
      `Transición no permitida desde estado ${current}.`,
    );
  }
}

export async function loadProductionOrderForExecution(orderId: string) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      lines: {
        where: { lineStatus: ProductionOrderLineStatus.ACTIVE },
        include: {
          task: { select: { id: true, lampId: true, projectId: true, process: true } },
        },
      },
    },
  });
  if (!order) throw new Error("Orden de producción no encontrada.");
  return order;
}

export async function finishProductionOrderTx(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    userId: string;
    actualHours: number;
  },
): Promise<{ entryCount: number }> {
  const order = await tx.productionOrder.findUnique({
    where: { id: args.orderId },
    include: {
      lines: {
        where: { lineStatus: ProductionOrderLineStatus.ACTIVE },
        include: {
          task: { select: { id: true, lampId: true, projectId: true, process: true } },
        },
      },
    },
  });
  if (!order) throw new Error("Orden de producción no encontrada.");
  assertOrderTransition(order.status, [
    ProductionOrderStatus.PEND,
    ProductionOrderStatus.CURSO,
    ProductionOrderStatus.INT,
    ProductionOrderStatus.MULTI,
  ]);

  const { userNotes, meta } = parseOrderExecutionMeta(order.notes);
  const totalHours =
    args.actualHours > 0 ? args.actualHours : meta.actualHours > 0 ? meta.actualHours : (order.hours ?? 0);
  if (totalHours <= 0) {
    throw new Error("Indica las horas reales antes de finalizar la OP.");
  }

  const lineInputs: ProductionOrderLineForDistribution[] = order.lines.map((l) => ({
    id: l.id,
    taskId: l.taskId,
    projectId: l.projectId,
    units: l.units,
    ral: l.ral,
  }));
  const eligible = eligibleLinesForHourDistribution(lineInputs, order.process);
  if (eligible.length === 0) {
    throw new Error("No hay líneas activas para imputar horas.");
  }

  const byLine = distributeHoursToLines(eligible, totalHours);
  const endedAt = new Date();
  let cursor = new Date(endedAt.getTime() - totalHours * 60 * 60 * 1000);
  let entryCount = 0;

  for (const line of order.lines) {
    const hours = byLine.get(line.id);
    if (!hours || hours <= 0) continue;
    if (!line.taskId || !line.projectId) continue;

    const lineEnd = new Date(cursor.getTime() + hours * 60 * 60 * 1000);
    await tx.timeEntry.create({
      data: {
        userId: args.userId,
        projectId: line.projectId,
        lampId: line.task?.lampId ?? undefined,
        taskId: line.taskId,
        process: order.process ?? line.task?.process ?? undefined,
        source: TimeEntrySource.MANUAL,
        startedAt: cursor,
        endedAt: lineEnd,
        hours,
        notes: `OP ${order.number}`,
      },
    });
    cursor = lineEnd;
    entryCount += 1;

    await tx.productionOrderLine.update({
      where: { id: line.id },
      data: { lineStatus: ProductionOrderLineStatus.FULFILLED },
    });
  }

  await tx.productionOrder.update({
    where: { id: order.id },
    data: {
      status: ProductionOrderStatus.CERR,
      notes: serializeOrderNotes(userNotes, { actualHours: totalHours }),
    },
  });

  return { entryCount };
}
