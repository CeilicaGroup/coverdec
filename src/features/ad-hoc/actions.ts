"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { Role } from "@/generated/prisma";
import { createAdHocTaskRecord } from "./create-ad-hoc-task";
import { updateAdHocTaskRecord } from "./update-ad-hoc-task";
import { injectPendingAdHocIntoDraftPlanning } from "./schedule-ad-hoc-tasks";
import {
  assertCanDeleteAdHocTask,
  deleteAdHocTaskRecord,
} from "./delete-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "./constants";
import {
  AD_HOC_PERSON_NOT_FOUND_ERROR,
  resolveAdHocNaveId,
} from "./resolve-ad-hoc-nave";

const log = childLogger({ module: "ad-hoc.actions" });

const createAdHocTaskSchema = z.object({
  personIds: z.array(z.string().min(1)).min(1),
  estimatedHours: z.number().positive().max(24),
  notes: z.string().min(1).max(500),
  internalNotes: z.string().min(1).max(500),
  projectId: z.string().min(1),
  naveId: z.string().min(1).optional(),
  process: z.string().min(1).optional(),
});

function revalidateAdHocPaths() {
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/desviaciones-tiempos");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/gantt");
}

export async function createAdHocTask(
  input: z.infer<typeof createAdHocTaskSchema>,
): Promise<
  ActionResult<{ taskId: string; scheduledInPlanning: boolean; unplacedHours: number }>
> {
  return runServerAction(
    "ad-hoc.createAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createAdHocTaskSchema.parse(input);

      const uniquePersonIds = [...new Set(data.personIds)];
      const people = await prisma.person.findMany({
        where: { id: { in: uniquePersonIds }, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (people.length !== uniquePersonIds.length) {
        throw new Error(AD_HOC_PERSON_NOT_FOUND_ERROR);
      }

      const naveId = resolveAdHocNaveId(
        people.map((person) => ({
          personId: person.id,
          naveIds: person.personNaves.map((row) => row.naveId),
        })),
        data.naveId,
      );

      if (data.process) {
        const processDef = await prisma.processDefinition.findUnique({
          where: { code: data.process },
          select: { code: true },
        });
        if (!processDef) throw new Error("Proceso no encontrado.");
      }

      const result = await prisma.$transaction((tx) =>
        createAdHocTaskRecord(tx, {
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          notes: data.notes,
          internalNotes: data.internalNotes,
          projectId: data.projectId,
          process: data.process ?? IMPREVISTA_PROCESS_CODE,
          createdByUserId: ctx.userId,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          projectId: data.projectId,
          process: data.process,
        },
        "ad-hoc task created",
      );

      const injected = await injectPendingAdHocIntoDraftPlanning({
        naveId,
        taskIds: [result.taskId],
      });
      if (injected.scheduledCount > 0) {
        log.info(
          { taskId: result.taskId, naveId },
          "ad-hoc task injected into draft planning",
        );
      }

      revalidateAdHocPaths();
      return {
        taskId: result.taskId,
        scheduledInPlanning: injected.scheduledCount > 0,
        // Horas que no caben en el borrador de esta semana (se colocan al generar la siguiente).
        unplacedHours: injected.unplacedHours,
      };
    },
    (result) => ({
      summary: "Crear tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
}

const updateAdHocTaskSchema = createAdHocTaskSchema.extend({
  taskId: z.string().min(1),
});

export async function updateAdHocTask(
  input: z.infer<typeof updateAdHocTaskSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  return runServerAction(
    "ad-hoc.updateAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = updateAdHocTaskSchema.parse(input);

      const uniquePersonIds = [...new Set(data.personIds)];
      const people = await prisma.person.findMany({
        where: { id: { in: uniquePersonIds }, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (people.length !== uniquePersonIds.length) {
        throw new Error(AD_HOC_PERSON_NOT_FOUND_ERROR);
      }

      const naveId = resolveAdHocNaveId(
        people.map((person) => ({
          personId: person.id,
          naveIds: person.personNaves.map((row) => row.naveId),
        })),
        data.naveId,
      );

      if (data.process) {
        const processDef = await prisma.processDefinition.findUnique({
          where: { code: data.process },
          select: { code: true },
        });
        if (!processDef) throw new Error("Proceso no encontrado.");
      }

      const result = await prisma.$transaction((tx) =>
        updateAdHocTaskRecord(tx, {
          taskId: data.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          notes: data.notes,
          internalNotes: data.internalNotes,
          projectId: data.projectId,
          process: data.process ?? IMPREVISTA_PROCESS_CODE,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          projectId: data.projectId,
          process: data.process,
        },
        "ad-hoc task updated",
      );

      revalidateAdHocPaths();
      return { taskId: result.taskId };
    },
    (result) => ({
      summary: "Editar tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
}

const deleteAdHocTaskSchema = z.object({
  taskId: z.string().min(1),
});

export async function deleteAdHocTask(
  input: z.infer<typeof deleteAdHocTaskSchema>,
): Promise<ActionResult<void>> {
  return runServerAction(
    "ad-hoc.deleteAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = deleteAdHocTaskSchema.parse(input);

      const task = await prisma.task.findFirst({
        where: { id: data.taskId },
        include: { _count: { select: { timeEntries: true } } },
      });
      if (!task) throw new Error("Tarea no encontrada.");

      assertCanDeleteAdHocTask(task);

      await prisma.$transaction((tx) => deleteAdHocTaskRecord(tx, task.id));

      log.info({ taskId: task.id }, "ad-hoc task deleted");

      revalidateAdHocPaths();
    },
    () => ({
      summary: "Eliminar tarea imprevista",
      entityType: "Task",
      entityId: input.taskId,
    }),
  );
}
