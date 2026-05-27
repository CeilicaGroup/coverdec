"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma";
import { TimeEntrySource } from "@/generated/prisma";
import { isTaskUnlocked } from "@/features/projects/lamp-tasks";
import { assertNoTimeOverlap } from "@/features/time-tracking/overlap";
import { Role } from "@/generated/prisma";

const log = childLogger({ module: "time-tracking.actions" });

async function creditWorkOnTask(
  tx: Prisma.TransactionClient,
  params: { taskId: string | null | undefined; hours: number },
) {
  if (!params.taskId || params.hours <= 0) return;
  const task = await tx.task.findFirst({
    where: { id: params.taskId },
    select: { id: true, doneHours: true, pendingHours: true },
  });
  if (!task) {
    log.warn({ taskId: params.taskId }, "time entry task not found; skipping task hour sync");
    return;
  }
  await tx.task.update({
    where: { id: task.id },
    data: {
      doneHours: task.doneHours + params.hours,
      pendingHours: Math.max(0, task.pendingHours - params.hours),
    },
  });
}

async function reverseWorkOnTask(
  tx: Prisma.TransactionClient,
  params: { taskId: string | null | undefined; hours: number },
) {
  if (!params.taskId || params.hours <= 0) return;
  const task = await tx.task.findFirst({
    where: { id: params.taskId },
    select: { id: true, doneHours: true, pendingHours: true },
  });
  if (!task) {
    log.warn({ taskId: params.taskId }, "delete time entry: task not found; skipping task hour sync");
    return;
  }
  await tx.task.update({
    where: { id: task.id },
    data: {
      doneHours: Math.max(0, task.doneHours - params.hours),
      pendingHours: task.pendingHours + params.hours,
    },
  });
}

function revalidateHorasAndLoad() {
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard", "layout");
}

async function assertTaskAccessible(
  ctx: Awaited<ReturnType<typeof requireDashboardContext>>,
  taskId: string | undefined,
) {
  if (!taskId || ctx.role === Role.ADMIN) return;
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: { naveId: true },
  });
  if (!task) throw new Error("Tarea no encontrada.");
  if (!ctx.naveIds.includes(task.naveId)) {
    throw new Error("No tienes acceso a tareas de esa nave.");
  }
}

const startSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  process: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
});

export async function startTimer(input: z.infer<typeof startSchema>) {
  const ctx = await requireDashboardContext();
  const data = startSchema.parse(input);
  const open = await prisma.timeEntry.findFirst({
    where: { userId: ctx.userId, endedAt: null },
  });
  if (open) {
    throw new Error("Ya tienes un timer activo. Detenlo primero.");
  }
  if (data.taskId) {
    await assertTaskAccessible(ctx, data.taskId);
    const unlocked = await isTaskUnlocked(data.taskId);
    if (!unlocked) {
      throw new Error(
        "Esta tarea está bloqueada: completa antes los procesos anteriores de la misma lámpara.",
      );
    }
  }
  await prisma.timeEntry.create({
    data: {
      userId: ctx.userId,
      projectId: data.projectId,
      lampId: data.lampId,
      taskId: data.taskId,
      process: data.process,
      source: TimeEntrySource.TIMER,
      startedAt: new Date(),
      notes: data.notes,
    },
  });
  log.info({ userId: ctx.userId, projectId: data.projectId }, "timer started");
  revalidateHorasAndLoad();
}

const stopSchema = z.object({ entryId: z.string().min(1) });

export async function stopTimer(input: z.infer<typeof stopSchema>) {
  const ctx = await requireDashboardContext();
  const data = stopSchema.parse(input);
  const entry = await prisma.timeEntry.findFirst({
    where: { id: data.entryId, userId: ctx.userId, endedAt: null },
  });
  if (!entry) throw new Error("Timer no encontrado");
  const endedAt = new Date();
  const hours = (endedAt.getTime() - entry.startedAt.getTime()) / 3600000;
  await assertNoTimeOverlap(ctx.userId, entry.startedAt, endedAt, entry.id);
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: entry.id },
      data: { endedAt, hours },
    });
    await creditWorkOnTask(tx, { taskId: entry.taskId, hours });
  });
  log.info({ entryId: entry.id, hours }, "timer stopped");
  revalidateHorasAndLoad();
}

const manualSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  process: z.string().min(1).optional(),
  startedAt: z.string().min(8),
  hours: z.number().positive().max(24),
  notes: z.string().max(500).optional(),
});

export async function createManualEntry(input: z.infer<typeof manualSchema>) {
  const ctx = await requireDashboardContext();
  const data = manualSchema.parse(input);
  if (data.taskId) {
    await assertTaskAccessible(ctx, data.taskId);
    const unlocked = await isTaskUnlocked(data.taskId);
    if (!unlocked) {
      throw new Error(
        "Esta tarea está bloqueada: completa antes los procesos anteriores de la misma lámpara.",
      );
    }
  }
  const startedAt = new Date(data.startedAt);
  const endedAt = new Date(startedAt.getTime() + data.hours * 3600000);
  await assertNoTimeOverlap(ctx.userId, startedAt, endedAt);
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.create({
      data: {
        userId: ctx.userId,
        projectId: data.projectId,
        lampId: data.lampId,
        taskId: data.taskId,
        process: data.process,
        source: TimeEntrySource.MANUAL,
        startedAt,
        endedAt,
        hours: data.hours,
        notes: data.notes,
      },
    });
    await creditWorkOnTask(tx, { taskId: data.taskId, hours: data.hours });
  });
  revalidateHorasAndLoad();
}

const deleteSchema = z.object({ entryId: z.string().min(1) });

export async function deleteEntry(input: z.infer<typeof deleteSchema>) {
  const ctx = await requireDashboardContext();
  const data = deleteSchema.parse(input);
  const entry = await prisma.timeEntry.findFirst({
    where: { id: data.entryId, userId: ctx.userId },
    select: { id: true, taskId: true, hours: true, endedAt: true },
  });
  if (!entry) return;
  const hours = entry.hours ?? 0;
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.delete({ where: { id: entry.id } });
    if (entry.endedAt && hours > 0) {
      await reverseWorkOnTask(tx, { taskId: entry.taskId, hours });
    }
  });
  revalidateHorasAndLoad();
}
