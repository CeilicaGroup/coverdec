"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import { Role } from "@/generated/prisma";
import { assertPlanningAssignmentsWorkOrderWorkers } from "./validate-planning-assignments";
import { planExecutorChanges } from "./plan-executor-changes";

const log = childLogger({ module: "work-orders.set-work-order-executors" });

/** UI/business convention (not a hard schema constraint): a task can be
 * manually reinforced to at most 2 people at once. */
const MAX_EXECUTORS = 2;

const schema = z.object({
  workOrderId: z.string().min(1),
  personIds: z.array(z.string().min(1)).min(1).max(MAX_EXECUTORS),
});

/**
 * Manually choose who executes an already-planned work order. Unlike
 * requiredWorkers (chapas: synchronized, standard hours already split
 * between N people), this duplicates hours: each chosen person gets their
 * own full-hours PlanningAssignment rows, mirroring whatever slots are
 * already there — for speeding up delivery, not splitting the same work.
 */
export async function setWorkOrderExecutors(
  input: z.infer<typeof schema>,
): Promise<void> {
  return runAuditedMutation(
    "work-orders.setWorkOrderExecutors",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = schema.parse(input);
      const personIds = [...new Set(data.personIds)];

      const openTasks = await prisma.task.findMany({
        where: { workOrderId: data.workOrderId, isCompleted: false },
        select: {
          id: true,
          naveId: true,
          assignments: {
            select: {
              id: true,
              planningId: true,
              personId: true,
              date: true,
              startSlot: true,
              endSlot: true,
              hours: true,
              process: true,
              isAfternoon: true,
            },
          },
        },
      });
      if (openTasks.length === 0) {
        throw new Error("La OT no tiene tareas abiertas.");
      }
      // OT tasks always share one nave in this app's model.
      const naveId = openTasks[0]!.naveId;

      const people = await prisma.person.findMany({
        where: { id: { in: personIds }, isActive: true },
        select: { id: true, personNaves: { select: { naveId: true } } },
      });
      if (people.length !== personIds.length) {
        throw new Error("Alguna persona seleccionada no existe o está inactiva.");
      }
      for (const person of people) {
        if (!person.personNaves.some((pn) => pn.naveId === naveId)) {
          throw new Error("Todos los operarios deben pertenecer a la nave de la OT.");
        }
      }

      const unplannedTask = openTasks.find((t) => t.assignments.length === 0);
      if (unplannedTask) {
        throw new Error(
          "Solo se pueden elegir ejecutores para una OT con tareas ya planificadas.",
        );
      }

      await prisma.$transaction(async (tx) => {
        const affectedPlanningIds = new Set<string>();

        for (const task of openTasks) {
          for (const row of task.assignments) {
            affectedPlanningIds.add(row.planningId);
          }

          const plan = planExecutorChanges(task.assignments, personIds);
          const rowById = new Map(task.assignments.map((r) => [r.id, r]));

          if (plan.rowIdsToDelete.length > 0) {
            await tx.planningAssignment.deleteMany({
              where: { id: { in: plan.rowIdsToDelete } },
            });
          }

          const templateRows = plan.templateRowIds
            .map((id) => rowById.get(id))
            .filter((row): row is (typeof task.assignments)[number] => row != null);

          for (const personId of plan.personIdsToAdd) {
            if (templateRows.length === 0) continue;
            await tx.planningAssignment.createMany({
              data: templateRows.map((row) => ({
                planningId: row.planningId,
                taskId: task.id,
                personId,
                date: row.date,
                startSlot: row.startSlot,
                endSlot: row.endSlot,
                hours: row.hours,
                process: row.process,
                isAfternoon: row.isAfternoon,
                isOverride: true,
              })),
            });
          }
        }

        for (const planningId of affectedPlanningIds) {
          await assertPlanningAssignmentsWorkOrderWorkers(tx, planningId);
        }
      });

      log.info(
        { workOrderId: data.workOrderId, personIds },
        "work order executors set",
      );
      revalidatePath("/dashboard/admin/ordenes-trabajo");
      revalidatePath("/dashboard/horas");
    },
    () => ({
      summary: "Elegir ejecutores de OT",
      entityType: "WorkOrder",
      entityId: input.workOrderId,
      metadata: { personIds: input.personIds },
    }),
  );
}
