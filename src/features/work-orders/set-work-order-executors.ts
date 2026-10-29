"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { Role, type Prisma } from "@/generated/prisma";
import { assertPlanningAssignmentsWorkOrderWorkers } from "./validate-planning-assignments";
import { planExecutorChanges, todayPlanningDate } from "./plan-executor-changes";

const log = childLogger({ module: "work-orders.set-work-order-executors" });

async function assertExecutorsNotDoubleBooked(
  tx: Prisma.TransactionClient,
  personIds: string[],
  tasks: { assignments: { date: Date }[] }[],
): Promise<void> {
  const dates = [
    ...new Set(tasks.flatMap((t) => t.assignments.map((a) => a.date.getTime()))),
  ].map((ms) => new Date(ms));
  if (dates.length === 0) return;
  const rows = await tx.planningAssignment.findMany({
    where: { personId: { in: personIds }, date: { in: dates } },
    select: {
      personId: true,
      date: true,
      startSlot: true,
      endSlot: true,
      person: { select: { iniciales: true } },
    },
    orderBy: [{ personId: "asc" }, { date: "asc" }, { startSlot: "asc" }],
  });
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const row = rows[i]!;
    if (
      prev.personId === row.personId &&
      prev.date.getTime() === row.date.getTime() &&
      row.startSlot < prev.endSlot
    ) {
      throw new Error(
        `${row.person.iniciales} ya tiene otra tarea planificada a esa hora el ${row.date
          .toISOString()
          .slice(0, 10)}.`,
      );
    }
  }
}

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
): Promise<ActionResult<void>> {
  return runServerAction(
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
          process: true,
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
        select: {
          id: true,
          iniciales: true,
          personNaves: { select: { naveId: true } },
          specialties: { select: { process: true } },
        },
      });
      if (people.length !== personIds.length) {
        throw new Error("Alguna persona seleccionada no existe o está inactiva.");
      }
      for (const person of people) {
        if (!person.personNaves.some((pn) => pn.naveId === naveId)) {
          throw new Error("Todos los operarios deben pertenecer a la nave de la OT.");
        }
        // Responsable o apoyo: cualquier especialidad registrada del proceso vale.
        const skills = new Set(person.specialties.map((s) => s.process));
        const missing = [...new Set(openTasks.map((t) => t.process))].filter((p) => !skills.has(p));
        if (missing.length > 0) {
          throw new Error(
            `${person.iniciales} no tiene la especialidad ${missing.join(", ")} de esta OT.`,
          );
        }
      }

      if (openTasks.some((t) => t.assignments.length === 0)) {
        throw new Error(
          "Esta OT aún no está en ningún planning. Genera el planning de la semana y luego elige los operarios.",
        );
      }
      // Solo se cambia de hoy en adelante: las franjas de días pasados son historia
      // y no se borran, copian ni cuentan para choques.
      const today = todayPlanningDate().getTime();
      const tasks = openTasks.map((t) => ({
        ...t,
        assignments: t.assignments.filter((a) => a.date.getTime() >= today),
      }));
      if (tasks.some((t) => t.assignments.length === 0)) {
        throw new Error(
          "Alguna tarea de esta OT no tiene planning de hoy en adelante. Regenera el planning de la semana y luego elige los operarios.",
        );
      }

      await prisma.$transaction(async (tx) => {
        const affectedPlanningIds = new Set<string>();

        for (const task of tasks) {
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

          // Remaining rows (kept people's, usually the solver's, and past days')
          // must be overrides too: the worker cap counts only override people, and
          // regenerating the week keeps only override rows for this task.
          await tx.planningAssignment.updateMany({
            where: { taskId: task.id, isOverride: false },
            data: { isOverride: true },
          });
        }

        for (const planningId of affectedPlanningIds) {
          await assertPlanningAssignmentsWorkOrderWorkers(tx, planningId);
        }

        // Duplicar franjas no puede poner a nadie en dos tareas a la vez.
        await assertExecutorsNotDoubleBooked(tx, personIds, tasks);
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
