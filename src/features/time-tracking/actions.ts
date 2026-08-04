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
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";
import {
  closeWorkOrderIfAllTasksComplete,
  reopenWorkOrderIfClosed,
} from "@/features/work-orders/close";
import {
  distributeHoursByEstimatedHours,
  splitRangesByTaskHours,
  type GroupedOtTimeRange,
} from "@/features/time-tracking/grouped-ot";
import {
  applyBreakHandling,
  type BreakScheduleContext,
  type BreakHandling,
  type TimeRangeSlice,
} from "@/features/time-tracking/break-handling";
import {
  buildScheduleOverrides,
  buildWeeklyScheduleFromWorkWindows,
} from "@/features/planning/person-day-capacity";

const log = childLogger({ module: "time-tracking.actions" });

function revalidateHorasAndLoad() {
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/mes");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
  revalidatePath("/dashboard/gantt");
  revalidatePath("/dashboard/desviaciones-tiempos");
  revalidatePath("/dashboard/admin/ordenes-trabajo");
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

function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function loadBreakScheduleForRanges(
  personId: string | null,
  ranges: TimeRangeSlice[],
): Promise<BreakScheduleContext | null> {
  if (!personId || ranges.length === 0) return null;
  const start = ranges.reduce(
    (min, range) => (range.startedAt < min ? range.startedAt : min),
    ranges[0]!.startedAt,
  );
  const end = ranges.reduce(
    (max, range) => (range.endedAt > max ? range.endedAt : max),
    ranges[0]!.endedAt,
  );

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      workWindows: {
        select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
      },
      scheduleOverrides: {
        where: {
          date: {
            gte: utcDayStart(start),
            lte: utcDayStart(end),
          },
        },
        select: {
          date: true,
          windows: {
            select: { startMinutes: true, endMinutes: true },
          },
        },
      },
    },
  });

  if (!person || person.workWindows.length === 0) return null;

  return {
    weekly: buildWeeklyScheduleFromWorkWindows(person.workWindows),
    overrides: buildScheduleOverrides(person.scheduleOverrides),
  };
}

const startSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  process: z.string().min(1).optional(),
  notes: z.string().max(500).optional(),
});

export async function startTimer(
  input: z.infer<typeof startSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.startTimer", async () => {
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
      "Esta tarea está bloqueada: completa antes los procesos anteriores del mismo elemento.",
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
  });
}

const stopSchema = z.object({ entryId: z.string().min(1) });

export async function stopTimer(
  input: z.infer<typeof stopSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.stopTimer", async () => {
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
  });
}

const completeTaskSchema = z.object({ taskId: z.string().min(1) });

const groupedCompleteSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("timer"),
    taskId: z.string().min(1),
    timerEntryId: z.string().min(1),
    quantity: z.number().int().min(1).max(100),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    mode: z.literal("manualRanges"),
    taskId: z.string().min(1),
    projectId: z.string().min(1),
    lampId: z.string().min(1).optional(),
    process: z.string().min(1),
    breakHandling: z.enum(["worked_extra", "took_break"]).optional(),
    quantity: z.number().int().min(1).max(100),
    notes: z.string().max(500).optional(),
    ranges: z
      .array(
        z.object({
          startedAt: z.string().min(8),
          endedAt: z.string().min(8),
        }),
      )
      .min(1)
      .max(20),
  }),
]);

export async function recordAndCompleteGroupedOtTasks(
  input: z.infer<typeof groupedCompleteSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.recordAndCompleteGroupedOtTasks", async () => {
    const ctx = await requireDashboardContext();
    const data = groupedCompleteSchema.parse(input);
    let manualRangeResult:
      | ReturnType<typeof applyBreakHandling>
      | null = null;

    await assertTaskAccessible(ctx, data.taskId);
    if (data.mode === "manualRanges") {
      await assertNoOpenTimer(ctx.userId);
      await assertTaskMatchesSelection(data);
      const parsedRanges = data.ranges.map((range) => ({
        startedAt: new Date(range.startedAt),
        endedAt: new Date(range.endedAt),
      }));
      assertNoInternalOverlaps(parsedRanges);
      const schedule = await loadBreakScheduleForRanges(ctx.personId, parsedRanges);
      manualRangeResult = applyBreakHandling(parsedRanges, schedule, data.breakHandling);
      for (const range of manualRangeResult.ranges) {
        await assertNoTimeOverlap(ctx.userId, range.startedAt, range.endedAt);
      }
    }

    await prisma.$transaction(async (tx) => {
      const baseTask = await tx.task.findFirst({
        where: { id: data.taskId },
        select: {
          id: true,
          projectId: true,
          lampId: true,
          process: true,
          isCompleted: true,
          workOrderId: true,
          workOrderSequence: true,
          estimatedHours: true,
        },
      });
      if (!baseTask) throw new Error("Tarea no encontrada.");
      if (baseTask.isCompleted) throw new Error("La tarea ya está completada.");
      if (!baseTask.workOrderId) {
        throw new Error("Esta tarea no pertenece a una OT agrupable.");
      }

      const pendingTasks = await tx.task.findMany({
        where: {
          workOrderId: baseTask.workOrderId,
          isCompleted: false,
        },
        select: {
          id: true,
          projectId: true,
          lampId: true,
          process: true,
          workOrderSequence: true,
          isCompleted: true,
          estimatedHours: true,
        },
      });

      const pendingInOt = pendingTasks.sort((a, b) => {
        const aSeq = a.workOrderSequence ?? Number.MAX_SAFE_INTEGER;
        const bSeq = b.workOrderSequence ?? Number.MAX_SAFE_INTEGER;
        if (aSeq !== bSeq) return aSeq - bSeq;
        return a.id.localeCompare(b.id);
      });

      if (pendingInOt.length === 0) {
        throw new Error("No hay tareas pendientes en la OT seleccionada.");
      }
      if (data.quantity > pendingInOt.length) {
        throw new Error(`Solo quedan ${pendingInOt.length} tareas pendientes en la OT.`);
      }

      const selectedTasks = pendingInOt.slice(0, data.quantity);
      const selectedTaskIds = new Set(selectedTasks.map((task) => task.id));
      if (!selectedTaskIds.has(baseTask.id)) {
        throw new Error("Debes completar primero la tarea pendiente más prioritaria de la OT.");
      }
      const unlockState = await Promise.all(selectedTasks.map((task) => isTaskUnlocked(task.id)));
      if (unlockState.some((isUnlocked) => !isUnlocked)) {
        throw new Error(
          "Alguna tarea de la OT está bloqueada: completa antes los procesos anteriores del mismo elemento.",
        );
      }

      let ranges: GroupedOtTimeRange[] = [];
      let totalHours = 0;
      let timerEntryId: string | null = null;
      const finishedAt = new Date();

      if (data.mode === "timer") {
        const openTimer = await tx.timeEntry.findFirst({
          where: { id: data.timerEntryId, userId: ctx.userId, endedAt: null },
          select: { id: true, taskId: true, projectId: true, lampId: true, process: true, startedAt: true },
        });
        if (!openTimer) throw new Error("No hay un timer activo válido para completar el grupo.");
        if (openTimer.taskId !== data.taskId) {
          throw new Error("El timer activo no corresponde a la tarea seleccionada.");
        }
        totalHours = resolveTimeEntryHours(
          { startedAt: openTimer.startedAt, endedAt: finishedAt, hours: null },
          finishedAt,
        );
        if (totalHours <= 0) {
          throw new Error("El timer no tiene duración suficiente para registrar horas.");
        }
        ranges = [{ startedAt: openTimer.startedAt, endedAt: finishedAt }];
        timerEntryId = openTimer.id;
      } else {
        ranges = manualRangeResult?.ranges ?? [];
        totalHours = computeTotalHours(ranges);
        if (totalHours <= 0) {
          throw new Error("No se puede registrar un reparto con horas totales iguales a 0.");
        }
      }

      const distributedHours = distributeHoursByEstimatedHours(totalHours, selectedTasks);
      const entrySegments = splitRangesByTaskHours(ranges, distributedHours);
      const entryPayloads = entrySegments.flatMap((segments, index) =>
        segments.map((segment) => ({
          userId: ctx.userId,
          projectId: selectedTasks[index].projectId,
          lampId: selectedTasks[index].lampId,
          taskId: selectedTasks[index].id,
          process: selectedTasks[index].process,
          source: data.mode === "timer" ? TimeEntrySource.TIMER : TimeEntrySource.MANUAL,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          hours: segment.hours,
          notes: data.notes,
        })),
      );
      if (entryPayloads.length === 0) {
        throw new Error("No se han podido generar registros de tiempo.");
      }

      if (data.mode === "timer" && timerEntryId) {
        const [firstPayload, ...remainingPayloads] = entryPayloads;
        await tx.timeEntry.update({
          where: { id: timerEntryId },
          data: {
            projectId: firstPayload.projectId,
            lampId: firstPayload.lampId,
            taskId: firstPayload.taskId,
            process: firstPayload.process,
            source: firstPayload.source,
            startedAt: firstPayload.startedAt,
            endedAt: firstPayload.endedAt,
            hours: firstPayload.hours,
            notes: firstPayload.notes,
          },
        });
        if (remainingPayloads.length > 0) {
          await tx.timeEntry.createMany({
            data: remainingPayloads,
          });
        }
      } else {
        await tx.timeEntry.createMany({
          data: entryPayloads,
        });
      }

      await tx.task.updateMany({
        where: { id: { in: selectedTasks.map((task) => task.id) } },
        data: { isCompleted: true },
      });
      await closeWorkOrderIfAllTasksComplete(tx, baseTask.workOrderId);
    });

    log.info(
      {
        userId: ctx.userId,
        taskId: data.taskId,
        quantity: data.quantity,
        mode: data.mode,
        breakHandling: data.mode === "manualRanges" ? (manualRangeResult?.appliedBreakHandling ?? null) : null,
      },
      "grouped ot tasks recorded and completed",
    );
    revalidateHorasAndLoad();

    const { evaluateCatalogTimeDeviationForTask } = await import(
      "./task-time-deviation-scan"
    );
    void evaluateCatalogTimeDeviationForTask(data.taskId).catch(() => {
      /* scanner errors must not block grouped completion */
    });
  });
}

export async function completeTask(
  input: z.infer<typeof completeTaskSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.completeTask", async () => {
  const ctx = await requireDashboardContext();
  const data = completeTaskSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await assertNoOpenTimer(ctx.userId);

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: data.taskId },
      select: { id: true, isCompleted: true, workOrderId: true },
    });
    if (!task) throw new Error("Tarea no encontrada.");
    if (task.isCompleted) return;
    await tx.task.update({
      where: { id: task.id },
      data: {
        isCompleted: true,
      },
    });
    if (task.workOrderId) {
      await closeWorkOrderIfAllTasksComplete(tx, task.workOrderId);
    }
  });

  log.info({ userId: ctx.userId, taskId: data.taskId }, "task completed");
  revalidateHorasAndLoad();

  const { evaluateCatalogTimeDeviationForTask } = await import(
    "./task-time-deviation-scan"
  );
  void evaluateCatalogTimeDeviationForTask(data.taskId).catch(() => {
    /* scanner errors must not block task completion */
  });
  });
}

export async function uncompleteTask(
  input: z.infer<typeof completeTaskSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.uncompleteTask", async () => {
  const ctx = await requireDashboardContext();
  const data = completeTaskSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: data.taskId },
      select: { workOrderId: true },
    });
    if (!task) throw new Error("Tarea no encontrada.");
    await tx.task.update({
      where: { id: data.taskId },
      data: { isCompleted: false },
    });
    if (task.workOrderId) {
      await reopenWorkOrderIfClosed(tx, task.workOrderId);
    }
  });
  log.info({ userId: ctx.userId, taskId: data.taskId }, "task uncompleted");
  revalidateHorasAndLoad();
  });
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

export async function createManualEntry(
  input: z.infer<typeof manualSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.createManualEntry", async () => {
  const ctx = await requireDashboardContext();
  const data = manualSchema.parse(input);
  await assertTaskAccessible(ctx, data.taskId);
  await assertTaskMatchesSelection(data);
  const unlocked = await isTaskUnlocked(data.taskId);
  if (!unlocked) {
    throw new Error(
      "Esta tarea está bloqueada: completa antes los procesos anteriores del mismo elemento.",
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
  });
}

const manualRangesSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1),
  process: z.string().min(1),
  notes: z.string().max(500).optional(),
  markCompleted: z.boolean().optional(),
  breakHandling: z.enum(["worked_extra", "took_break"]).optional(),
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
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.createManualEntriesFromRanges", async () => {
  const ctx = await requireDashboardContext();
  const data = manualRangesSchema.parse(input);

  await assertTaskAccessible(ctx, data.taskId);
  const unlocked = await isTaskUnlocked(data.taskId);
  if (!unlocked) {
    throw new Error(
      "Esta tarea está bloqueada: completa antes los procesos anteriores del mismo elemento.",
    );
  }

  const parsedRanges = data.ranges.map((r) => ({
    startedAt: new Date(r.startedAt),
    endedAt: new Date(r.endedAt),
  }));

  assertNoInternalOverlaps(parsedRanges);
  const schedule = await loadBreakScheduleForRanges(ctx.personId, parsedRanges);
  const handledRanges = applyBreakHandling(parsedRanges, schedule, data.breakHandling);

  for (const r of handledRanges.ranges) {
    await assertNoTimeOverlap(ctx.userId, r.startedAt, r.endedAt);
  }

  const totalHours = computeTotalHours(handledRanges.ranges);

  await prisma.$transaction(async (tx) => {
    for (const r of handledRanges.ranges) {
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
      const task = await tx.task.findFirst({
        where: { id: data.taskId },
        select: { id: true, workOrderId: true },
      });
      if (!task) throw new Error("Tarea no encontrada.");
      await tx.task.update({ where: { id: task.id }, data: { isCompleted: true } });
      if (task.workOrderId) {
        await closeWorkOrderIfAllTasksComplete(tx, task.workOrderId);
      }
    }
  });

  log.info(
    {
      userId: ctx.userId,
      taskId: data.taskId,
      ranges: handledRanges.ranges.length,
      totalHours,
      breakHandling: handledRanges.appliedBreakHandling ?? null,
    },
    "manual ranges created",
  );
  revalidateHorasAndLoad();
  });
}

const deleteSchema = z.object({ entryId: z.string().min(1) });

export async function deleteEntry(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.deleteEntry", async () => {
  const ctx = await requireDashboardContext();
  const data = deleteSchema.parse(input);
  const entry = await prisma.timeEntry.findFirst({
    where: { id: data.entryId },
    select: { id: true, userId: true, taskId: true, hours: true, endedAt: true },
  });
  if (!entry) throw new Error("Registro no encontrado.");
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
  });
}

const updateEntrySchema = z.object({
  entryId: z.string().min(1),
  startedAt: z.string().min(8),
  endedAt: z.string().min(8),
  notes: z.string().max(500).optional(),
});

export async function updateEntry(
  input: z.infer<typeof updateEntrySchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.updateEntry", async () => {
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
  });
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

export async function createManualEntryForTask(
  input: z.infer<typeof createForTaskSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("time-tracking.createManualEntryForTask", async () => {
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
  });
}
