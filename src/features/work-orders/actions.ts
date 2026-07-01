"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";
import { childLogger } from "@/lib/logger";
import { autoGroupIdenticalTasksInTx } from "./auto-group";
import { allocateWorkOrderNumber } from "./number";
import {
  createWorkOrderSchema,
  deleteWorkOrderSchema,
  updateWorkOrderSchema,
} from "./schema";
import { assertWorkOrderDeletable } from "./delete-guard";
import { assignTasksToWorkOrder } from "./validate-tasks";

const log = childLogger({ module: "work-orders.actions" });

const WORK_ORDERS_PATH = "/dashboard/admin/ordenes-trabajo";

function revalidateWorkOrders() {
  revalidatePath(WORK_ORDERS_PATH);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
  revalidatePath("/dashboard/gantt");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/proyectos", "layout");
}

export async function createWorkOrder(
  input: unknown,
): Promise<ActionResult<{ id: string; number: string }>> {
  return runServerAction("work-orders.create", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = createWorkOrderSchema.parse(input);

    const result = await prisma.$transaction(async (tx) => {
      const { year, serial, number } = await allocateWorkOrderNumber(tx);
      const workOrder = await tx.workOrder.create({
        data: { number, year, serial, notes: data.notes },
      });
      await assignTasksToWorkOrder(tx, workOrder.id, data.taskIds);
      return { id: workOrder.id, number: workOrder.number };
    });

    log.info(result, "work order created");
    revalidateWorkOrders();
    return result;
  });
}

export async function updateWorkOrder(
  input: unknown,
): Promise<ActionResult<void>> {
  return runServerAction("work-orders.update", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = updateWorkOrderSchema.parse(input);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.workOrder.findUnique({
        where: { id: data.id },
        select: { id: true, status: true },
      });
      if (!existing) throw new Error("OT no encontrada.");
      if (existing.status !== "OPEN") {
        throw new Error("Solo se pueden editar OT abiertas.");
      }

      if (data.notes !== undefined) {
        await tx.workOrder.update({
          where: { id: data.id },
          data: { notes: data.notes },
        });
      }

      if (data.taskIds) {
        await assignTasksToWorkOrder(tx, data.id, data.taskIds);
      }
    });

    log.info({ id: data.id }, "work order updated");
    revalidateWorkOrders();
  });
}

export async function deleteWorkOrder(
  input: unknown,
): Promise<ActionResult<void>> {
  return runServerAction("work-orders.delete", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = deleteWorkOrderSchema.parse(input);

    await prisma.$transaction(async (tx) => {
      const existing = await tx.workOrder.findUnique({
        where: { id: data.id },
        select: { id: true },
      });
      if (!existing) throw new Error("OT no encontrada.");

      await assertWorkOrderDeletable(tx, data.id);

      await tx.task.updateMany({
        where: { workOrderId: data.id },
        data: { workOrderId: null, workOrderSequence: null },
      });
      await tx.workOrder.delete({ where: { id: data.id } });
    });

    log.info({ id: data.id }, "work order deleted");
    revalidateWorkOrders();
  });
}

export async function autoGroupIdenticalTasks(): Promise<
  ActionResult<{ ordersCreated: number; tasksGrouped: number }>
> {
  return runServerAction("work-orders.autoGroup", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);

    const result = await prisma.$transaction(autoGroupIdenticalTasksInTx);

    log.info(result, "work orders auto-grouped");
    revalidateWorkOrders();
    return result;
  });
}
