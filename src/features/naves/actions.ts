"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";

const naveSchema = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
});

export async function createNave(input: z.infer<typeof naveSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const data = naveSchema.parse(input);
  const nave = await prisma.nave.create({ data });
  revalidatePath("/dashboard/admin/naves");
  return { id: nave.id };
}

const updateNaveSchema = naveSchema.extend({ naveId: z.string().min(1) });

export async function updateNave(input: z.infer<typeof updateNaveSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const { naveId, ...data } = updateNaveSchema.parse(input);
  await prisma.nave.update({ where: { id: naveId }, data });
  revalidatePath("/dashboard/admin/naves");
}

export async function toggleNaveActive(naveId: string, isActive: boolean) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  await prisma.nave.update({ where: { id: naveId }, data: { isActive } });
  revalidatePath("/dashboard/admin/naves");
}

export async function assignLampToNave(lampId: string, naveId: string) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  await prisma.lamp.findFirstOrThrow({ where: { id: lampId } });
  await prisma.task.updateMany({ where: { lampId }, data: { naveId } });
  revalidatePath("/dashboard/proyectos");
}

export async function updateTaskNave(taskId: string, naveId: string) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  await prisma.task.findFirstOrThrow({ where: { id: taskId } });
  await prisma.task.update({ where: { id: taskId }, data: { naveId } });
  revalidatePath("/dashboard/proyectos");
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
