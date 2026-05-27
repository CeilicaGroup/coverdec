"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import type { Prisma } from "@/generated/prisma";
import { NotificationType, TimeEntrySource } from "@/generated/prisma";
import { isTaskUnlocked } from "@/features/projects/lamp-tasks";
import { assertNoTimeOverlap } from "@/features/time-tracking/overlap";
import { Role } from "@/generated/prisma";
import {
  assertNoInternalOverlaps,
  computeTotalHours,
} from "@/features/time-tracking/manual-ranges";
import { emitNotificationTx } from "@/features/notifications/service";
import { resolveNotificationStates } from "@/features/notifications/service";

const log = childLogger({ module: "time-tracking.actions" });

async function creditWorkOnTask(
  tx: Prisma.TransactionClient,
  params: { taskId: string | null | undefined; hours: number },
) {
  if (!params.taskId || params.hours <= 0) return;
  const task = await tx.task.findFirst({
    where: { id: params.taskId },
    select: {
      id: true,
      doneHours: true,
      pendingHours: true,
      estimatedHours: true,
      process: true,
      projectId: true,
      naveId: true,
      lamp: { select: { name: true } },
      project: { select: { name: true, code: true, responsibleUserId: true } },
    },
  });
  if (!task) {
    log.warn({ taskId: params.taskId }, "time entry task not found; skipping task hour sync");
    return;
  }
  const updatedTask = await tx.task.update({
    where: { id: task.id },
    data: {
      doneHours: task.doneHours + params.hours,
      pendingHours: Math.max(0, task.pendingHours - params.hours),
    },
    select: { doneHours: true },
  });

  if (updatedTask.doneHours > task.estimatedHours + 1e-6) {
    const dayKey = new Date().toISOString().slice(0, 10);
    await emitNotificationTx(tx, {
      type: NotificationType.TASK_HOURS_EXCEEDED,
      title: "Tarea por encima de horas previstas",
      body:
        `La tarea ${task.process} de ${task.lamp?.name ?? "lámpara"} ` +
        `supera lo estimado (${updatedTask.doneHours.toFixed(1)}h / ${task.estimatedHours.toFixed(1)}h).`,
      payload: {
        eventKey: `task-hours-exceeded:${task.id}:${dayKey}`,
        taskId: task.id,
        projectId: task.projectId,
        naveId: task.naveId,
        estimatedHours: task.estimatedHours,
        doneHours: updatedTask.doneHours,
      },
      projectId: task.projectId,
      naveId: task.naveId,
      responsibleUserId: task.project.responsibleUserId,
      scopeKey: `task-overrun:${task.id}`,
    });
  } else {
    await resolveNotificationStates({
      type: NotificationType.TASK_HOURS_EXCEEDED,
      scopeKeys: [`task-overrun:${task.id}`],
    });
  }
}

async function reverseWorkOnTask(
  tx: Prisma.TransactionClient,
  params: { taskId: string | null | undefined; hours: number },
) {
  if (!params.taskId || params.hours <= 0) return;
  const task = await tx.task.findFirst({
    where: { id: params.taskId },
    select: { id: true, doneHours: true, pendingHours: true, estimatedHours: true },
  });
  if (!task) {
    log.warn({ taskId: params.taskId }, "delete time entry: task not found; skipping task hour sync");
    return;
  }
  const newDoneHours = Math.max(0, task.doneHours - params.hours);
  await tx.task.update({
    where: { id: task.id },
    data: {
      doneHours: newDoneHours,
      pendingHours: task.pendingHours + params.hours,
    },
  });
  if (newDoneHours <= task.estimatedHours + 1e-6) {
    await resolveNotificationStates({
      type: NotificationType.TASK_HOURS_EXCEEDED,
      scopeKeys: [`task-overrun:${task.id}`],
    });
  }
}

function revalidateHorasAndLoad() {
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard", "layout");
}

async function assertNoOpenTimer(ctxUserId: string) {
  const open = await prisma.timeEntry.findFirst({
    where: { userId: ctxUserId, endedAt: null },
    select: { id: true, taskId: true },
  });
  if (open) {
    throw new Error("Tienes un timer activo. Páralo antes de completar tareas.");
  }
}

async function assertTaskAccessible(
  ctx: Awaited<ReturnType<typeof requireDashboardContext>>,
  taskId: string,
) {
  if (ctx.role === Role.ADMIN) return;
  const task = await prisma.task.findFirst({
    where: { id: taskId },
    select: { naveId: true },
  });
  if (!task) throw new Error("Tarea no encontrada.");
  if (!ctx.naveIds.includes(task.naveId)) {
    throw new Error("No tienes acceso a tareas de esa nave.");
  }
}

async function assertTaskMatchesSelection(params: {
  taskId: string;
  projectId: string;
  lampId?: string;
  process?: string;
}) {
  const task = await prisma.task.findFirst({
    where: { id: params.taskId },
    select: { projectId: true, lampId: true, process: true },
  });
  if (!task) throw new Error("Tarea no encontrada.");
  if (task.projectId !== params.projectId) {
    throw new Error("La tarea no pertenece al proyecto seleccionado.");
  }
  if (params.lampId && task.lampId !== params.lampId) {
    throw new Error("La tarea no pertenece a la lámpara seleccionada.");
  }
  if (params.process && task.process !== params.process) {
    throw new Error("La tarea no coincide con el proceso seleccionado.");
  }
}

const startSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
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
  await assertTaskAccessible(ctx, data.taskId);
  await assertTaskMatchesSelection(data);
  const unlocked = await isTaskUnlocked(data.taskId);
  if (!unlocked) {
    throw new Error(
      "Esta tarea está bloqueada: completa antes los procesos anteriores de la misma lámpara.",
    );
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

const completeTaskSchema = z.object({ taskId: z.string().min(1) });

export async function completeTask(input: z.infer<typeof completeTaskSchema>) {
  const ctx = await requireDashboardContext();
  const data = completeTaskSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await assertNoOpenTimer(ctx.userId);

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: data.taskId },
      select: { id: true, isCompleted: true },
    });
    if (!task) throw new Error("Tarea no encontrada.");
    if (task.isCompleted) return;
    await tx.task.update({
      where: { id: task.id },
      data: { isCompleted: true },
    });
  });

  log.info({ userId: ctx.userId, taskId: data.taskId }, "task completed");
  revalidateHorasAndLoad();
}

const manualSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  process: z.string().min(1).optional(),
  startedAt: z.string().min(8),
  hours: z.number().positive().max(24),
  notes: z.string().max(500).optional(),
});

export async function createManualEntry(input: z.infer<typeof manualSchema>) {
  const ctx = await requireDashboardContext();
  const data = manualSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await assertTaskMatchesSelection(data);
  const unlocked = await isTaskUnlocked(data.taskId);
  if (!unlocked) {
    throw new Error(
      "Esta tarea está bloqueada: completa antes los procesos anteriores de la misma lámpara.",
    );
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

const manualRangesSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  process: z.string().min(1),
  notes: z.string().max(500).optional(),
  markCompleted: z.boolean().optional(),
  ranges: z
    .array(
      z.object({
        startedAt: z.string().min(8),
        endedAt: z.string().min(8),
      }),
    )
    .min(1)
    .max(20),
});

export async function createManualEntriesFromRanges(
  input: z.infer<typeof manualRangesSchema>,
) {
  const ctx = await requireDashboardContext();
  const data = manualRangesSchema.parse(input);

  await assertTaskAccessible(ctx, data.taskId);
  const unlocked = await isTaskUnlocked(data.taskId);
  if (!unlocked) {
    throw new Error(
      "Esta tarea está bloqueada: completa antes los procesos anteriores de la misma lámpara.",
    );
  }

  const parsedRanges = data.ranges.map((r) => ({
    startedAt: new Date(r.startedAt),
    endedAt: new Date(r.endedAt),
  }));

  assertNoInternalOverlaps(parsedRanges);

  for (const r of parsedRanges) {
    await assertNoTimeOverlap(ctx.userId, r.startedAt, r.endedAt);
  }

  const totalHours = computeTotalHours(parsedRanges);

  await prisma.$transaction(async (tx) => {
    for (const r of parsedRanges) {
      const hours = (r.endedAt.getTime() - r.startedAt.getTime()) / 3600000;
      await tx.timeEntry.create({
        data: {
          userId: ctx.userId,
          projectId: data.projectId,
          lampId: data.lampId,
          taskId: data.taskId,
          process: data.process,
          source: TimeEntrySource.MANUAL,
          startedAt: r.startedAt,
          endedAt: r.endedAt,
          hours,
          notes: data.notes,
        },
      });
    }
    await creditWorkOnTask(tx, { taskId: data.taskId, hours: totalHours });
    if (data.markCompleted) {
      await tx.task.update({
        where: { id: data.taskId },
        data: { isCompleted: true },
      });
    }
  });

  log.info(
    { userId: ctx.userId, taskId: data.taskId, ranges: data.ranges.length, totalHours },
    "manual ranges created",
  );
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
