"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { TimeEntrySource } from "@/generated/prisma";
import { isTaskUnlocked } from "@/features/projects/lamp-tasks";
import { assertNoTimeOverlap } from "@/features/time-tracking/overlap";
import { Role } from "@/generated/prisma";
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";
import {
  assertNoInternalOverlaps,
  computeTotalHours,
} from "@/features/time-tracking/manual-ranges";
import { computeTaskHourTotals } from "@/features/time-tracking/task-hours-derived";

const log = childLogger({ module: "time-tracking.actions" });
function revalidateHorasAndLoad() {
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
  revalidatePath("/dashboard/gantt");
  revalidatePath("/dashboard", "layout");
}

function assertCanEditEntry(ctx: Awaited<ReturnType<typeof requireDashboardContext>>, entryUserId: string) {
  if (ctx.role === Role.ADMIN) return;
  if (ctx.userId !== entryUserId) {
    throw new Error("No tienes permisos para modificar este registro.");
  }
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
  const hours = resolveTimeEntryHours(
    { startedAt: entry.startedAt, endedAt, hours: null },
    endedAt,
  );
  await assertNoTimeOverlap(ctx.userId, entry.startedAt, endedAt, entry.id);
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: entry.id },
      data: { endedAt, hours },
    });
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
      data: {
        isCompleted: true,
      },
    });
  });

  log.info({ userId: ctx.userId, taskId: data.taskId }, "task completed");
  revalidateHorasAndLoad();
}

export async function uncompleteTask(input: z.infer<typeof completeTaskSchema>) {
  const ctx = await requireDashboardContext();
  const data = completeTaskSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await prisma.task.update({
    where: { id: data.taskId },
    data: { isCompleted: false },
  });
  log.info({ userId: ctx.userId, taskId: data.taskId }, "task uncompleted");
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
    where: { id: data.entryId },
    select: { id: true, userId: true, taskId: true, hours: true, endedAt: true },
  });
  if (!entry) return;
  assertCanEditEntry(ctx, entry.userId);
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.delete({ where: { id: entry.id } });
    if (entry.taskId) {
      const task = await tx.task.findFirst({
        where: { id: entry.taskId },
        select: {
          id: true,
          isCompleted: true,
          estimatedHours: true,
          timeEntries: {
            select: { startedAt: true, endedAt: true, hours: true },
          },
        },
      });
      const doneHours = (task?.timeEntries ?? []).reduce(
        (sum, item) =>
          sum + resolveTimeEntryHours(item),
        0,
      );
      const totals = task
        ? computeTaskHourTotals(task.estimatedHours, doneHours)
        : null;
      if (task?.isCompleted && (totals?.remainingWorkHours ?? 0) > 0.01) {
        await tx.task.update({
          where: { id: task.id },
          data: { isCompleted: false },
        });
      }
    }
  });
  revalidateHorasAndLoad();
}

const updateEntrySchema = z.object({
  entryId: z.string().min(1),
  startedAt: z.string().min(8),
  endedAt: z.string().min(8),
  notes: z.string().max(500).optional(),
});

export async function updateEntry(input: z.infer<typeof updateEntrySchema>) {
  const ctx = await requireDashboardContext();
  const data = updateEntrySchema.parse(input);
  const startedAt = new Date(data.startedAt);
  const endedAt = new Date(data.endedAt);
  if (!(endedAt > startedAt)) {
    throw new Error("Rango inválido: el fin debe ser posterior al inicio.");
  }

  const entry = await prisma.timeEntry.findFirst({
    where: { id: data.entryId },
    select: {
      id: true,
      userId: true,
      taskId: true,
      hours: true,
      startedAt: true,
      endedAt: true,
    },
  });
  if (!entry) throw new Error("Registro no encontrado.");
  assertCanEditEntry(ctx, entry.userId);

  await assertNoTimeOverlap(entry.userId, startedAt, endedAt, entry.id);
  const newHours = resolveTimeEntryHours(
    { startedAt, endedAt, hours: null },
    endedAt,
  );

  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.update({
      where: { id: entry.id },
      data: {
        startedAt,
        endedAt,
        hours: newHours,
        notes: data.notes,
      },
    });
    if (entry.taskId) {
      const task = await tx.task.findFirst({
        where: { id: entry.taskId },
        select: {
          id: true,
          isCompleted: true,
          estimatedHours: true,
          timeEntries: {
            select: { startedAt: true, endedAt: true, hours: true },
          },
        },
      });
      const doneHours = (task?.timeEntries ?? []).reduce(
        (sum, item) =>
          sum + resolveTimeEntryHours(item),
        0,
      );
      const totals = task
        ? computeTaskHourTotals(task.estimatedHours, doneHours)
        : null;
      if (task?.isCompleted && (totals?.remainingWorkHours ?? 0) > 0.01) {
        await tx.task.update({
          where: { id: task.id },
          data: { isCompleted: false },
        });
      }
    }
  });
  revalidateHorasAndLoad();
}

const createForTaskSchema = z.object({
  userId: z.string().min(1).optional(),
  personId: z.string().min(1).optional(),
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  process: z.string().min(1),
  startedAt: z.string().min(8),
  endedAt: z.string().min(8),
  notes: z.string().max(500).optional(),
});

export async function createManualEntryForTask(input: z.infer<typeof createForTaskSchema>) {
  const ctx = await requireDashboardContext();
  const data = createForTaskSchema.parse(input);
  const targetUserId = await (async () => {
    if (data.userId) return data.userId;
    if (!data.personId) throw new Error("Falta usuario destino para el registro.");
    const user = await prisma.user.findFirst({
      where: { personId: data.personId },
      select: { id: true },
    });
    if (!user?.id) throw new Error("La persona seleccionada no tiene usuario.");
    return user.id;
  })();
  if (ctx.role !== Role.ADMIN && targetUserId !== ctx.userId) {
    throw new Error("No tienes permisos para crear registros para este usuario.");
  }
  await assertTaskAccessible(ctx, data.taskId);
  await assertTaskMatchesSelection(data);
  const startedAt = new Date(data.startedAt);
  const endedAt = new Date(data.endedAt);
  if (!(endedAt > startedAt)) {
    throw new Error("Rango inválido: el fin debe ser posterior al inicio.");
  }
  await assertNoTimeOverlap(targetUserId, startedAt, endedAt);
  const hours = resolveTimeEntryHours(
    { startedAt, endedAt, hours: null },
    endedAt,
  );
  await prisma.$transaction(async (tx) => {
    await tx.timeEntry.create({
      data: {
        userId: targetUserId,
        projectId: data.projectId,
        lampId: data.lampId,
        taskId: data.taskId,
        process: data.process,
        source: TimeEntrySource.MANUAL,
        startedAt,
        endedAt,
        hours,
        notes: data.notes,
      },
    });
  });
  revalidateHorasAndLoad();
}
