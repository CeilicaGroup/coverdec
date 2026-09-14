"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import { Role } from "@/generated/prisma";
import { assertPersonSharesNave, assertTaskSubstitutable } from "./task-substitute";
import { revalidateLampSurfaces } from "./revalidate-surfaces";

const log = childLogger({ module: "projects.substitute-actions" });

async function revalidateSubstitutePaths(lampId: string) {
  revalidatePath("/dashboard/horas");
  await revalidateLampSurfaces(lampId);
}

async function loadSubstitutableTask(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      naveId: true,
      lampId: true,
      systemKind: true,
      _count: { select: { assignments: true } },
    },
  });
  if (!task) throw new Error("Tarea no encontrada.");
  assertTaskSubstitutable(task);
  return task;
}

async function assertPersonInNave(personId: string, naveId: string) {
  const person = await prisma.person.findFirst({
    where: { id: personId, isActive: true },
    select: { personNaves: { select: { naveId: true } } },
  });
  if (!person) throw new Error("Persona no encontrada.");
  assertPersonSharesNave(
    person.personNaves.map((pn) => pn.naveId),
    naveId,
  );
}

const addSchema = z.object({
  taskId: z.string().min(1),
  personId: z.string().min(1),
});

export async function addTaskSubstitute(input: z.infer<typeof addSchema>): Promise<void> {
  return runAuditedMutation(
    "projects.addTaskSubstitute",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = addSchema.parse(input);

      const task = await loadSubstitutableTask(data.taskId);
      await assertPersonInNave(data.personId, task.naveId);

      await prisma.taskParticipant.upsert({
        where: { taskId_personId: { taskId: data.taskId, personId: data.personId } },
        create: { taskId: data.taskId, personId: data.personId },
        update: {},
      });

      log.info({ taskId: data.taskId, personId: data.personId }, "task substitute added");
      await revalidateSubstitutePaths(task.lampId);
    },
    () => ({
      summary: "Añadir sustituto a tarea",
      entityType: "Task",
      entityId: input.taskId,
      metadata: { substitutePersonId: input.personId },
    }),
  );
}

const removeSchema = z.object({
  taskId: z.string().min(1),
  personId: z.string().min(1),
});

export async function removeTaskSubstitute(input: z.infer<typeof removeSchema>): Promise<void> {
  return runAuditedMutation(
    "projects.removeTaskSubstitute",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = removeSchema.parse(input);

      const task = await prisma.task.findFirst({
        where: { id: data.taskId },
        select: { lampId: true },
      });
      if (!task) throw new Error("Tarea no encontrada.");

      await prisma.taskParticipant.deleteMany({
        where: { taskId: data.taskId, personId: data.personId },
      });

      log.info({ taskId: data.taskId, personId: data.personId }, "task substitute removed");
      await revalidateSubstitutePaths(task.lampId);
    },
    () => ({
      summary: "Quitar sustituto de tarea",
      entityType: "Task",
      entityId: input.taskId,
      metadata: { substitutePersonId: input.personId },
    }),
  );
}
