import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { runPlanningEngine, SolverInfeasibleError } from "./engine";
import type { PlanFrom } from "@/features/planning/plan-from";
import { loadSolverInput } from "./load-engine-input";
import { isTaskClosedForPlanning } from "./task-planning-status";
import {
  getPriorPlanningAssignments,
  sumPriorPlannedHoursByTaskId,
} from "./prior-week-planning";
import {
  PlanningStatus,
    type Prisma,
} from "@/generated/prisma";
import { getMondayOf, isoWeek } from "@/lib/week";
import { detectPlanningPublishNotifications } from "@/features/notifications/detectors";
import { emitNotificationTx } from "@/features/notifications/service";

const log = childLogger({ module: "planning.service" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** DB writes only; CP-SAT solver runs outside the transaction (often 10–60s). */
const PLANNING_WRITE_TX_MS = 30_000;

async function restoreAssignmentHoursToTasks(
  tx: Prisma.TransactionClient,
  planningId: string,
): Promise<void> {
  const oldSums = await tx.planningAssignment.groupBy({
    by: ["taskId"],
    where: { planningId },
    _sum: { hours: true },
  });
  if (oldSums.length === 0) return;

  const taskIds = oldSums.map((r) => r.taskId);
  const tasks = await tx.task.findMany({ where: { id: { in: taskIds } } });
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  await Promise.all(
    oldSums.map(async (row) => {
      const add = row._sum.hours ?? 0;
      if (add <= 0) return;
      const task = taskMap.get(row.taskId);
      if (!task || isTaskClosedForPlanning(task)) return;
      await tx.task.update({
        where: { id: row.taskId },
        data: { pendingHours: task.pendingHours + add },
      });
    }),
  );
}

/** Alinea pendingHours con obra restante menos lo ya planificado en semanas anteriores. */
async function reconcileTaskPendingBeforeSolve(
  naveId: string,
  beforeWeekStart: Date,
): Promise<void> {
  const [tasks, priorByTask] = await Promise.all([
    prisma.task.findMany({
      where: { naveId, project: { isActive: true } },
      select: {
        id: true,
        pendingHours: true,
        doneHours: true,
        estimatedHours: true,
        isCompleted: true,
      },
    }),
    sumPriorPlannedHoursByTaskId({ naveId, beforeWeekStart }),
  ]);

  for (const task of tasks) {
    if (isTaskClosedForPlanning(task)) {
      if (task.isCompleted && task.pendingHours > 1e-6) {
        await prisma.task.update({
          where: { id: task.id },
          data: { pendingHours: 0 },
        });
      }
      continue;
    }
    const remaining = Math.max(0, task.estimatedHours - task.doneHours);
    const priorPlanned = priorByTask.get(task.id) ?? 0;
    const expectedPending = Math.max(0, remaining - priorPlanned);
    if (Math.abs(task.pendingHours - expectedPending) > 1e-6) {
      await prisma.task.update({
        where: { id: task.id },
        data: { pendingHours: expectedPending },
      });
    }
  }
}

const ENGINE_HORIZON_DAYS = 5;
/** Por debajo de 15 min de hueco sin colocar no bloqueamos el guardado del borrador. */
const UNSCHEDULED_FAIL_THRESHOLD_HOURS = 0.25;

export interface GeneratePlanningArgs {
  naveId: string;
  weekStart: Date;
  replaceDraft?: boolean;
  planFrom?: PlanFrom;
  planFromAt?: Date;
}

export interface GeneratedPlanning {
  planningId: string;
  warnings: string[];
  unscheduledHours: number;
  assignmentsCount: number;
}

export async function generatePlanning(
  args: GeneratePlanningArgs,
): Promise<GeneratedPlanning> {
  const replaceDraft = args.replaceDraft ?? true;
  const weekStart = getMondayOf(args.weekStart);
  const weekEnd = new Date(weekStart.getTime() + (ENGINE_HORIZON_DAYS - 1) * DAY_MS);
  const { year, week } = isoWeek(weekStart);
  log.info({ naveId: args.naveId, year, week }, "generate planning start");

  const existing = await prisma.planning.findUnique({
    where: {
      naveId_year_week: { naveId: args.naveId, year, week },
    },
  });

  if (existing && existing.status === PlanningStatus.PUBLISHED && !replaceDraft) {
    throw new Error(
      "El planning de esta semana está publicado. Usa «Deshacer» para eliminarlo o regenera desde el panel.",
    );
  }

  const previousAssignments = existing
    ? await prisma.planningAssignment.findMany({
      where: { planningId: existing.id },
    })
    : [];

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await restoreAssignmentHoursToTasks(tx, existing.id);
    });
  }

  await reconcileTaskPendingBeforeSolve(args.naveId, weekStart);

  const priorWeekAssignments = await getPriorPlanningAssignments({
    naveId: args.naveId,
    beforeWeekStart: weekStart,
  });

  const engineInput = await loadSolverInput({
    naveId: args.naveId,
    weekStart,
    weekEnd,
    planFrom: args.planFrom,
    planFromAt: args.planFromAt,
    previousAssignments,
    priorWeekAssignments,
  });

  if (engineInput.firstSchedulableDayIndex >= ENGINE_HORIZON_DAYS) {
    throw new Error(
      "«Planificar desde» no deja ningún día laborable en la semana del calendario. Elige «Lunes de la semana» o navega a la semana actual o futura.",
    );
  }

  const deferredHours = (engineInput.deferredTasks ?? []).reduce(
    (a, t) => a + t.hours,
    0,
  );

  if (engineInput.tasks.length === 0) {
    if (deferredHours > 0) {
      throw new Error(
        `Hay ${deferredHours.toFixed(1)}h pendientes que no pueden empezar en esta semana (tiempos de secado o cadena de procesos). Planifica una semana posterior o revisa el orden de las tareas.`,
      );
    }
    throw new Error(
      "No hay tareas con horas pendientes en proyectos activos. Revisa que las lámparas tengan tareas y horas estimadas.",
    );
  }

  const solveStarted = Date.now();
  let result;
  try {
    result = await runPlanningEngine(engineInput);
  } catch (err) {
    if (err instanceof SolverInfeasibleError) {
      throw new Error(err.message);
    }
    throw err;
  }
  log.info(
    {
      naveId: args.naveId,
      year,
      week,
      taskCount: engineInput.tasks.length,
      solveMs: Date.now() - solveStarted,
      assignments: result.assignments.length,
    },
    "planning solver done",
  );

  const totalUnplaced = result.unscheduledHours + deferredHours;
  if (
    result.assignments.length === 0 &&
    totalUnplaced > UNSCHEDULED_FAIL_THRESHOLD_HOURS
  ) {
    const hint =
      result.warnings[0]?.reason ??
      (deferredHours > 0
        ? `${deferredHours.toFixed(1)}h aplazadas por secado o cadena.`
        : "Revisa capacidad, especialidades y festivos.");
    throw new Error(
      `El solver no pudo colocar trabajo (${totalUnplaced.toFixed(1)}h sin asignar). ${hint}`,
    );
  }

  const planning = await prisma.$transaction(
    async (tx) => {
      if (existing) {
        await tx.planningAssignment.deleteMany({
          where: { planningId: existing.id },
        });
      }

      const upserted = existing
        ? await tx.planning.update({
          where: { id: existing.id },
          data: {
            status: PlanningStatus.DRAFT,
            weekStart,
            weekEnd,
            publishedAt: null,
          },
        })
        : await tx.planning.create({
          data: {
            naveId: args.naveId,
            year,
            week,
            weekStart,
            weekEnd,
          },
        });

      if (result.assignments.length > 0) {
        await tx.planningAssignment.createMany({
          data: result.assignments.map((a) => ({
            planningId: upserted.id,
            taskId: a.taskId,
            personId: a.personId,
            date: a.date,
            startSlot: a.startSlot,
            endSlot: a.endSlot,
            hours: a.hours,
            process: a.process,
            isAfternoon: a.isAfternoon,
          })),
        });
      }

      const newByTask = new Map<string, number>();
      for (const a of result.assignments) {
        newByTask.set(a.taskId, (newByTask.get(a.taskId) ?? 0) + a.hours);
      }
      for (const [taskId, hours] of newByTask) {
        const task = await tx.task.findUnique({ where: { id: taskId } });
        if (!task) continue;
        await tx.task.update({
          where: { id: taskId },
          data: { pendingHours: Math.max(0, task.pendingHours - hours) },
        });
      }

      return upserted;
    },
    { timeout: PLANNING_WRITE_TX_MS },
  );

  log.info(
    {
      planningId: planning.id,
      assignments: result.assignments.length,
      warnings: result.warnings.length,
    },
    "generate planning done",
  );

  const deferredWarnings = (engineInput.deferredTasks ?? []).map(
    (t) =>
      `Tarea ${t.taskId}: ${t.hours.toFixed(1)}h aplazadas (no caben en esta semana por secado/cadena).`,
  );

  return {
    planningId: planning.id,
    warnings: [
      ...deferredWarnings,
      ...result.warnings.map((w) => `Tarea ${w.taskId}: ${w.reason}`),
    ],
    unscheduledHours: result.unscheduledHours + deferredHours,
    assignmentsCount: result.assignments.length,
  };
}

export async function publishPlanning(planningId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const planning = await tx.planning.update({
      where: { id: planningId },
      data: { status: PlanningStatus.PUBLISHED, publishedAt: new Date() },
    });
    const alerts = await detectPlanningPublishNotifications(tx, planning.id);
    for (const alert of alerts) {
      await emitNotificationTx(tx, {
        type: alert.type,
        title: alert.title,
        body: alert.body,
        payload: alert.payload as never,
        planningId: planning.id,
        naveId: planning.naveId,
        scopeKey: (alert.payload as { eventKey?: string }).eventKey,
      });
    }
  });
}

export async function hasFuturePlannings(
  naveId: string,
  weekStart: Date,
): Promise<boolean> {
  const monday = getMondayOf(weekStart);
  const count = await prisma.planning.count({
    where: { naveId, weekStart: { gt: monday } },
  });
  return count > 0;
}

export async function undoPlanning(args: {
  naveId: string;
  weekStart: Date;
}): Promise<void> {
  const weekStart = getMondayOf(args.weekStart);
  const { year, week } = isoWeek(weekStart);

  const existing = await prisma.planning.findUnique({
    where: {
      naveId_year_week: { naveId: args.naveId, year, week },
    },
  });
  if (!existing) {
    throw new Error("No hay planning para esta semana.");
  }

  if (await hasFuturePlannings(args.naveId, weekStart)) {
    throw new Error(
      "No se puede deshacer: hay plannings de semanas posteriores. Elimínalos primero.",
    );
  }

  await prisma.$transaction(
    async (tx) => {
      await restoreAssignmentHoursToTasks(tx, existing.id);
      await tx.planning.delete({ where: { id: existing.id } });
    },
    { timeout: PLANNING_WRITE_TX_MS },
  );

  log.info(
    { naveId: args.naveId, year, week, planningId: existing.id },
    "planning undone",
  );
}

export { getMondayOf, isoWeek };
