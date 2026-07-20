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
  splitWorkOrderSchema,
  updateWorkOrderAlertThresholdsSchema,
  updateWorkOrderSchema,
} from "./schema";
import { assertWorkOrderDeletable } from "./delete-guard";
import { assignTasksToWorkOrder } from "./validate-tasks";
import { splitWorkOrderInTx } from "./split-work-order";

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

export async function splitWorkOrder(
  input: unknown,
): Promise<ActionResult<{ id: string; number: string }>> {
  return runServerAction("work-orders.split", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = splitWorkOrderSchema.parse(input);

    const result = await prisma.$transaction((tx) =>
      splitWorkOrderInTx(tx, {
        workOrderId: data.id,
        taskIds: data.taskIds,
        notes: data.notes,
      }),
    );

    log.info({ sourceId: data.id, newId: result.id }, "work order split");
    revalidateWorkOrders();
    return result;
  });
}

export async function updateWorkOrderAlertThresholds(
  input: unknown,
): Promise<ActionResult<void>> {
  return runServerAction("work-orders.updateAlertThresholds", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const data = updateWorkOrderAlertThresholdsSchema.parse(input);

    await prisma.user.update({
      where: { id: ctx.userId },
      data: {
        workOrderAlertMaxPendingHours: data.maxPendingHours,
        workOrderAlertMaxTasks: data.maxTasks,
      },
    });

    log.info(
      {
        userId: ctx.userId,
        maxPendingHours: data.maxPendingHours,
        maxTasks: data.maxTasks,
      },
      "work order alert thresholds updated",
    );
    revalidatePath(WORK_ORDERS_PATH);
  });
}
