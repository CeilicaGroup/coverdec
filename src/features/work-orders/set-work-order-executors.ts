"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { Role } from "@/generated/prisma";
import {
  ExecutorConflictError,
  applyExecutorsToPlannedTasks,
  keepAssignmentsFromToday,
  loadOpenTasksWithAssignments,
  saveWorkOrderExecutors,
} from "./apply-work-order-executors";

const log = childLogger({ module: "work-orders.set-work-order-executors" });

/** UI/business convention (not a hard schema constraint): a task can be
 * manually reinforced to at most 2 people at once. */
const MAX_EXECUTORS = 2;

const schema = z.object({
  workOrderId: z.string().min(1),
  personIds: z.array(z.string().min(1)).min(1).max(MAX_EXECUTORS),
});

export interface SetWorkOrderExecutorsResult {
  /** Alguna tarea espera al próximo planning para recibir a los elegidos. */
  pending: boolean;
  /** Por qué no se pudo aplicar ya (alguien ocupado o ausente en esas franjas). */
  conflict?: string;
}

/**
 * Manually choose who executes a work order (the first one is the
 * responsable). The choice is stored on the OT; tasks already planned from
 * today on get it right away (see applyExecutorsToPlannedTasks), the rest
 * when the week's planning is generated. If someone chosen is busy in the
 * planned slots, the choice is still stored and waits for the next
 * (re)generation, where the solver places the responsable around it.
 */
export async function setWorkOrderExecutors(
  input: z.infer<typeof schema>,
): Promise<ActionResult<SetWorkOrderExecutorsResult>> {
  return runServerAction(
    "work-orders.setWorkOrderExecutors",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = schema.parse(input);
      const personIds = [...new Set(data.personIds)];

      const openTasks = await loadOpenTasksWithAssignments(prisma, data.workOrderId);
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

      const tasks = keepAssignmentsFromToday(openTasks);
      const planned = tasks.filter((t) => t.assignments.length > 0);
      const pending = planned.length < tasks.length;

      let result: SetWorkOrderExecutorsResult = { pending };
      try {
        await prisma.$transaction(async (tx) => {
          await saveWorkOrderExecutors(tx, data.workOrderId, personIds);
          if (planned.length > 0) await applyExecutorsToPlannedTasks(tx, planned, personIds);
        });
      } catch (err) {
        if (!(err instanceof ExecutorConflictError)) throw err;
        await prisma.$transaction((tx) => saveWorkOrderExecutors(tx, data.workOrderId, personIds));
        result = { pending: true, conflict: err.message };
      }

      log.info(
        { workOrderId: data.workOrderId, personIds, ...result },
        "work order executors set",
      );
      revalidatePath("/dashboard/admin/ordenes-trabajo");
      revalidatePath("/dashboard/horas");
      return result;
    },
    () => ({
      summary: "Elegir ejecutores de OT",
      entityType: "WorkOrder",
      entityId: input.workOrderId,
      metadata: { personIds: input.personIds },
    }),
  );
}
