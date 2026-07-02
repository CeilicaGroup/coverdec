import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { runPlanningEngine, SolverInfeasibleError } from "./engine";
import type { PlanFrom } from "@/features/planning/plan-from";
import { loadSolverInput } from "./load-engine-input";
import { isTaskClosedForPlanning } from "./task-planning-status";
import {
  getPriorPlanningAssignments,
  getPriorPlanningAssignmentsForNaves,
  sumPriorPlannedHoursByTaskId,
} from "./prior-week-planning";
import {
  PlanningStatus,
    type Prisma,
} from "@/generated/prisma";
import { formatPlanningWarningMessages } from "@/features/planning/format-warnings";
import { hasRegistrosFromWeek } from "@/features/planning/planning-registros";
import { assertNaveSchedulableTasksHaveOpenWorkOrder } from "@/features/work-orders/require-for-planning";
import { assertPlanningAssignmentsWorkOrderWorkers } from "@/features/work-orders/validate-planning-assignments";
import { getMondayOf, isoWeek } from "@/lib/week";
import { detectPlanningPublishNotifications } from "@/features/notifications/detectors";
import { emitNotificationTx } from "@/features/notifications/service";
import { loadActiveNaveIdsOrdered } from "@/features/naves/active-naves";
import {
  assertSingleWorkerPerTask,
  assertSingleWorkerPerWorkOrder,
  findTasksWithMultipleWorkers,
} from "@/features/planning/validate-assignments";
import { buildWorkOrderIdByTaskId } from "@/features/work-orders/planning";
import type { EngineAssignment } from "./engine/types";

export { hasRegistrosFromWeek } from "@/features/planning/planning-registros";

const log = childLogger({ module: "planning.service" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** DB writes only; CP-SAT solver runs outside the transaction (often 10–60s). */
const PLANNING_WRITE_TX_MS = 30_000;

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

export interface NavePlanningResult extends GeneratedPlanning {
  naveId: string;
  naveCodigo: string;
}

export interface GenerateGlobalPlanningResult {
  perNave: NavePlanningResult[];
  warnings: string[];
  unscheduledHours: number;
  assignmentsCount: number;
  planningIds: string[];
}

function buildNoSchedulableTasksMessage(args: {
  deferredHours: number;
  priorHours: number;
}): string {
  if (args.deferredHours > 0) {
    return `Hay ${args.deferredHours.toFixed(1)}h pendientes que no pueden empezar en esta semana (tiempos de secado o cadena de procesos). Planifica una semana posterior o revisa el orden de las tareas.`;
  }
  if (args.priorHours > UNSCHEDULED_FAIL_THRESHOLD_HOURS) {
    return "No quedan horas por planificar en esta semana: el trabajo ya está cubierto en borradores de semanas anteriores. Revisa esas semanas en el calendario o deshaz/regenera desde la semana donde empezó el planning.";
  }
  return "No hay tareas con horas pendientes en proyectos activos. Revisa que las lámparas tengan tareas y horas estimadas.";
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

  const planFromAt = args.planFromAt ?? new Date();

  const priorWeekAssignments = await getPriorPlanningAssignments({
    naveId: args.naveId,
    beforeWeekStart: weekStart,
    includeDraftPriorWeeks: true,
  });

  await assertNaveSchedulableTasksHaveOpenWorkOrder({
    naveId: args.naveId,
    weekStart,
    planFromAt,
    priorWeekAssignments,
  });

  const engineInput = await loadSolverInput({
    naveIds: [args.naveId],
    weekStart,
    weekEnd,
    planFrom: args.planFrom,
    planFromAt,
    previousAssignments,
    priorWeekAssignments,
  });

  if (engineInput.firstSchedulableDayIndex >= ENGINE_HORIZON_DAYS) {
    throw new Error(
      "«Planificar desde» no deja ningún día laborable en la semana del calendario. Elige una fecha anterior o navega a otra semana.",
    );
  }

  const deferredHours = (engineInput.deferredTasks ?? []).reduce(
    (a, t) => a + t.hours,
    0,
  );

  if (engineInput.tasks.length === 0) {
    const priorHours = priorWeekAssignments.reduce((a, x) => a + x.hours, 0);
    throw new Error(
      buildNoSchedulableTasksMessage({ deferredHours, priorHours }),
    );
  }

  if (existing) {
    await prisma.planningAssignment.deleteMany({ where: { planningId: existing.id } });
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

  const workerConflicts = findTasksWithMultipleWorkers(result.assignments);
  if (workerConflicts.length > 0) {
    log.error(
      { naveId: args.naveId, year, week, conflicts: workerConflicts },
      "planning rejected: task assigned to multiple workers",
    );
  }
  assertSingleWorkerPerTask(result.assignments);

  const workOrderIdByTaskId = buildWorkOrderIdByTaskId(
    engineInput.tasks.map((t) => ({ id: t.id, workOrderId: t.workOrderId })),
  );
  assertSingleWorkerPerWorkOrder(
    result.assignments,
    workOrderIdByTaskId,
    engineInput.workOrderNumberById,
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
        // previous assignments were already removed before solving
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

  const rawWarnings = [
    ...(engineInput.deferredTasks ?? []).map((t) => ({
      taskId: t.taskId,
      reason: `${t.hours.toFixed(1)}h aplazadas (no caben en esta semana por secado o cadena de procesos)`,
    })),
    ...result.warnings.map((w) => ({
      taskId: w.taskId,
      reason: w.reason,
    })),
  ];

  const warnings = await formatPlanningWarningMessages(rawWarnings);

  return {
    planningId: planning.id,
    warnings,
    unscheduledHours: result.unscheduledHours + deferredHours,
    assignmentsCount: result.assignments.length,
  };
}

export async function generateGlobalPlanning(args: {
  weekStart: Date;
  replaceDraft?: boolean;
  planFrom?: PlanFrom;
  planFromAt?: Date;
  naves: Array<{ id: string; codigo: string }>;
}): Promise<GenerateGlobalPlanningResult> {
  const replaceDraft = args.replaceDraft ?? true;
  const weekStart = getMondayOf(args.weekStart);
  const weekEnd = new Date(weekStart.getTime() + (ENGINE_HORIZON_DAYS - 1) * DAY_MS);
  const { year, week } = isoWeek(weekStart);
  const naveIds = args.naves.map((nave) => nave.id);
  const planFromAt = args.planFromAt ?? new Date();

  log.info({ naveIds, year, week }, "generate global planning start");

  const existingPlannings = await prisma.planning.findMany({
    where: { naveId: { in: naveIds }, year, week },
  });
  const existingByNaveId = new Map(existingPlannings.map((row) => [row.naveId, row]));

  for (const existing of existingPlannings) {
    if (existing.status === PlanningStatus.PUBLISHED && !replaceDraft) {
      throw new Error(
        "El planning de esta semana está publicado. Usa «Deshacer» para eliminarlo o regenera desde el panel.",
      );
    }
  }

  const previousAssignments = existingPlannings.length
    ? await prisma.planningAssignment.findMany({
      where: { planningId: { in: existingPlannings.map((row) => row.id) } },
    })
    : [];

  const priorWeekAssignments = await getPriorPlanningAssignmentsForNaves({
    naveIds,
    beforeWeekStart: weekStart,
    includeDraftPriorWeeks: true,
  });

  const engineInput = await loadSolverInput({
    naveIds,
    weekStart,
    weekEnd,
    planFrom: args.planFrom,
    planFromAt,
    previousAssignments,
    priorWeekAssignments,
  });

  if (engineInput.firstSchedulableDayIndex >= ENGINE_HORIZON_DAYS) {
    throw new Error(
      "«Planificar desde» no deja ningún día laborable en la semana del calendario. Elige una fecha anterior o navega a otra semana.",
    );
  }

  const deferredHours = (engineInput.deferredTasks ?? []).reduce(
    (a, task) => a + task.hours,
    0,
  );

  if (engineInput.tasks.length === 0) {
    const priorHours = priorWeekAssignments.reduce((a, x) => a + x.hours, 0);
    throw new Error(
      buildNoSchedulableTasksMessage({ deferredHours, priorHours }),
    );
  }

  if (existingPlannings.length > 0) {
    await prisma.planningAssignment.deleteMany({
      where: { planningId: { in: existingPlannings.map((row) => row.id) } },
    });
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
      naveIds,
      year,
      week,
      taskCount: engineInput.tasks.length,
      solveMs: Date.now() - solveStarted,
      assignments: result.assignments.length,
    },
    "global planning solver done",
  );

  const workerConflicts = findTasksWithMultipleWorkers(result.assignments);
  if (workerConflicts.length > 0) {
    log.error(
      { naveIds, year, week, conflicts: workerConflicts },
      "global planning rejected: task assigned to multiple workers",
    );
  }
  assertSingleWorkerPerTask(result.assignments);

  const workOrderIdByTaskId = buildWorkOrderIdByTaskId(
    engineInput.tasks.map((task) => ({ id: task.id, workOrderId: task.workOrderId })),
  );
  assertSingleWorkerPerWorkOrder(
    result.assignments,
    workOrderIdByTaskId,
    engineInput.workOrderNumberById,
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

  const assignmentsByNaveId = new Map<string, EngineAssignment[]>();
  for (const naveId of naveIds) {
    assignmentsByNaveId.set(naveId, []);
  }
  for (const assignment of result.assignments) {
    const naveId = engineInput.naveIdByTaskId.get(assignment.taskId);
    if (!naveId) continue;
    assignmentsByNaveId.get(naveId)?.push(assignment);
  }

  const perNave: NavePlanningResult[] = [];
  await prisma.$transaction(
    async (tx) => {
      for (const nave of args.naves) {
        const existing = existingByNaveId.get(nave.id);
        const naveAssignments = assignmentsByNaveId.get(nave.id) ?? [];
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
              naveId: nave.id,
              year,
              week,
              weekStart,
              weekEnd,
            },
          });

        if (naveAssignments.length > 0) {
          await tx.planningAssignment.createMany({
            data: naveAssignments.map((assignment) => ({
              planningId: upserted.id,
              taskId: assignment.taskId,
              personId: assignment.personId,
              date: assignment.date,
              startSlot: assignment.startSlot,
              endSlot: assignment.endSlot,
              hours: assignment.hours,
              process: assignment.process,
              isAfternoon: assignment.isAfternoon,
            })),
          });
        }

        perNave.push({
          planningId: upserted.id,
          naveId: nave.id,
          naveCodigo: nave.codigo,
          warnings: [],
          unscheduledHours: 0,
          assignmentsCount: naveAssignments.length,
        });
      }
    },
    { timeout: PLANNING_WRITE_TX_MS * Math.max(args.naves.length, 1) },
  );

  const rawWarnings = [
    ...(engineInput.deferredTasks ?? []).map((task) => ({
      taskId: task.taskId,
      reason: `${task.hours.toFixed(1)}h aplazadas (no caben en esta semana por secado o cadena de procesos)`,
    })),
    ...result.warnings.map((warning) => ({
      taskId: warning.taskId,
      reason: warning.reason,
    })),
  ];
  const warnings = await formatPlanningWarningMessages(rawWarnings);

  log.info(
    {
      planningIds: perNave.map((row) => row.planningId),
      assignments: result.assignments.length,
      warnings: warnings.length,
    },
    "generate global planning done",
  );

  return {
    perNave,
    warnings,
    unscheduledHours: result.unscheduledHours + deferredHours,
    assignmentsCount: result.assignments.length,
    planningIds: perNave.map((row) => row.planningId),
  };
}

export async function publishPlanning(planningId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertPlanningAssignmentsWorkOrderWorkers(tx, planningId);

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

export async function publishAllPlanningsForWeek(
  weekStart: Date,
): Promise<{ publishedCount: number }> {
  const monday = getMondayOf(weekStart);
  const { year, week } = isoWeek(monday);
  const drafts = await prisma.planning.findMany({
    where: { year, week, status: PlanningStatus.DRAFT },
    select: { id: true },
    orderBy: { naveId: "asc" },
  });

  for (const draft of drafts) {
    await publishPlanning(draft.id);
  }

  log.info({ year, week, publishedCount: drafts.length }, "all plannings published for week");
  return { publishedCount: drafts.length };
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

export async function listFuturePlannings(
  naveId: string,
  weekStart: Date,
): Promise<Array<{ weekStart: Date; status: PlanningStatus }>> {
  const monday = getMondayOf(weekStart);
  return prisma.planning.findMany({
    where: { naveId, weekStart: { gt: monday } },
    orderBy: { weekStart: "asc" },
    select: { weekStart: true, status: true },
  });
}

export async function undoPlanning(args: {
  naveId: string;
  weekStart: Date;
  includeFutureWeeks?: boolean;
}): Promise<{ deletedCount: number }> {
  const weekStart = getMondayOf(args.weekStart);
  const includeFutureWeeks = args.includeFutureWeeks ?? false;
  const { year, week } = isoWeek(weekStart);

  const existing = await prisma.planning.findUnique({
    where: {
      naveId_year_week: { naveId: args.naveId, year, week },
    },
  });
  if (!existing) {
    throw new Error("No hay planning para esta semana.");
  }

  if (!includeFutureWeeks && (await hasFuturePlannings(args.naveId, weekStart))) {
    throw new Error(
      "No se puede deshacer: hay plannings de semanas posteriores. Elimínalos primero o deshaz también las semanas posteriores.",
    );
  }

  if (await hasRegistrosFromWeek(args.naveId, weekStart)) {
    throw new Error(
      "No se puede deshacer: hay registros de horas en esta semana o posteriores. Usa Regenerar.",
    );
  }

  const deletedCount = await prisma.$transaction(
    async (tx) => {
      if (includeFutureWeeks) {
        const result = await tx.planning.deleteMany({
          where: {
            naveId: args.naveId,
            weekStart: { gte: weekStart },
          },
        });
        return result.count;
      }

      await tx.planning.delete({ where: { id: existing.id } });
      return 1;
    },
    { timeout: PLANNING_WRITE_TX_MS },
  );

  log.info(
    {
      naveId: args.naveId,
      year,
      week,
      planningId: existing.id,
      includeFutureWeeks,
      deletedCount,
    },
    "planning undone",
  );

  return { deletedCount };
}

export async function undoPlanningAllNaves(args: {
  weekStart: Date;
  includeFutureWeeks?: boolean;
}): Promise<{ deletedCount: number }> {
  const naveIds = await loadActiveNaveIdsOrdered();
  let deletedCount = 0;

  for (const naveId of naveIds) {
    try {
      const result = await undoPlanning({
        naveId,
        weekStart: args.weekStart,
        includeFutureWeeks: args.includeFutureWeeks,
      });
      deletedCount += result.deletedCount;
    } catch (err) {
      if (err instanceof Error && err.message === "No hay planning para esta semana.") {
        continue;
      }
      throw err;
    }
  }

  if (deletedCount === 0) {
    throw new Error("No hay planning para esta semana.");
  }

  return { deletedCount };
}

export {
  clearFutureDraftPlannings,
  hasPublishedFuturePlannings,
  clearFutureDraftPlanningsAll,
  hasPublishedFuturePlanningsAll,
} from "@/features/planning/planning-horizon";

export { getMondayOf, isoWeek };
