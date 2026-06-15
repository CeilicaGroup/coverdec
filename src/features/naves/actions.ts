"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { Role } from "@/generated/prisma";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";

const naveSchema = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
});

export async function createNave(input: z.infer<typeof naveSchema>) {
  return runAuditedMutation(
    "naves.createNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const data = naveSchema.parse(input);
      const nave = await prisma.nave.create({ data });
      revalidatePath("/dashboard/admin/naves");
      return { id: nave.id };
    },
    (result) => ({
      summary: `Crear nave ${input.codigo}`,
      entityType: "Nave",
      entityId: result.id,
      metadata: input,
    }),
  );
}

const updateNaveSchema = naveSchema.extend({ naveId: z.string().min(1) });

export async function updateNave(input: z.infer<typeof updateNaveSchema>) {
  return runAuditedMutation(
    "naves.updateNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const { naveId, ...data } = updateNaveSchema.parse(input);
      await prisma.nave.update({ where: { id: naveId }, data });
      revalidatePath("/dashboard/admin/naves");
    },
    {
      summary: `Actualizar nave ${input.codigo}`,
      entityType: "Nave",
      entityId: input.naveId,
      metadata: input,
    },
  );
}

export async function toggleNaveActive(naveId: string, isActive: boolean) {
  return runAuditedMutation(
    "naves.toggleNaveActive",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      await prisma.nave.update({ where: { id: naveId }, data: { isActive } });
      revalidatePath("/dashboard/admin/naves");
    },
    {
      summary: isActive ? "Activar nave" : "Desactivar nave",
      entityType: "Nave",
      entityId: naveId,
      metadata: { isActive },
    },
  );
}

export async function assignLampToNave(lampId: string, naveId: string) {
  return runAuditedMutation(
    "naves.assignLampToNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      await prisma.lamp.findFirstOrThrow({ where: { id: lampId } });
      await prisma.task.updateMany({ where: { lampId }, data: { naveId } });
      revalidatePath("/dashboard/proyectos");
    },
    {
      summary: "Asignar lámpara a nave",
      entityType: "Lamp",
      entityId: lampId,
      metadata: { naveId },
    },
  );
}

/** @deprecated Use updateTaskNave from @/features/projects/actions */
export async function updateTaskNave(taskId: string, naveId: string) {
  const { updateTaskNave: updateTaskNaveAction } = await import(
    "@/features/projects/actions"
  );
  await updateTaskNaveAction({ taskId, naveId });
}

export async function getNaves() {
  return prisma.nave.findMany({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
  });
}

export async function getAllNavesWithDetails() {
  const naves = await prisma.nave.findMany({
    orderBy: { codigo: "asc" },
    include: {
      personNaves: {
        select: {
          person: {
            select: {
              user: {
                select: { id: true, name: true, email: true, role: true },
              },
            },
          },
        },
      },
      tasks: {
        select: {
          id: true,
          process: true,
          estimatedHours: true,
          project: { select: { name: true, code: true } },
        },
      },
    },
  });
  const taskIds = naves.flatMap((nave) => nave.tasks.map((task) => task.id));
  const doneByTaskId = await loadDoneHoursByTaskIds(prisma, taskIds);
  return naves.map((nave) => ({
    ...nave,
    tasks: nave.tasks.map((task) => {
      const doneHours = doneByTaskId.get(task.id) ?? 0;
      return {
        ...task,
        pendingHours: Math.max(0, task.estimatedHours - doneHours),
      };
    }),
  }));
}
