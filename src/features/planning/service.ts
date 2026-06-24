import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { runPlanningEngine, SolverInfeasibleError } from "./engine";
import type { PlanFrom } from "@/features/planning/plan-from";
import { loadSolverInput } from "./load-engine-input";
import { getPriorPlanningAssignmentsForNaves } from "./prior-week-planning";
import {
  PlanningStatus,
} from "@/generated/prisma";
import { formatPlanningWarningMessages } from "@/features/planning/format-warnings";
import { hasRegistrosFromWeek } from "@/features/planning/planning-registros";
import { getMondayOf, isoWeek } from "@/lib/week";
import { detectPlanningPublishNotifications } from "@/features/notifications/detectors";
import { emitNotificationTx } from "@/features/notifications/service";
import {
  assertSingleWorkerPerTask,
} from "@/features/planning/validate-assignments";

export { hasRegistrosFromWeek } from "@/features/planning/planning-registros";

const log = childLogger({ module: "planning.service" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** DB writes only; CP-SAT solver runs outside the transaction (often 10–60s). */
const PLANNING_WRITE_TX_MS = 30_000;

const ENGINE_HORIZON_DAYS = 5;
/** Por debajo de 15 min de hueco sin colocar no bloqueamos el guardado del borrador. */
const UNSCHEDULED_FAIL_THRESHOLD_HOURS = 0.25;

export interface GeneratePlanningArgs {
  naveIds: string[];
  weekStart: Date;
  replaceDraft?: boolean;
  planFrom?: PlanFrom;
  planFromAt?: Date;
}

export interface GeneratedPlanning {
  planningGroupId: string;
  plannings: Array<{
    naveId: string;
    planningId: string;
    assignmentsCount: number;
  }>;
  warnings: string[];
  unscheduledHours: number;
  assignmentsCount: number;
}

export async function generatePlanning(
  args: GeneratePlanningArgs,
): Promise<GeneratedPlanning> {
  const naveIds = [...new Set(args.naveIds)];
  if (naveIds.length === 0) {
    throw new Error("Se requiere al menos una nave para planificar");
  }

  const replaceDraft = args.replaceDraft ?? true;
  const weekStart = getMondayOf(args.weekStart);
  const weekEnd = new Date(weekStart.getTime() + (ENGINE_HORIZON_DAYS - 1) * DAY_MS);
  const { year, week } = isoWeek(weekStart);
  const planningGroupId = randomUUID();
  log.info({ naveIds, year, week, planningGroupId }, "generate planning start");

  const existingList = await prisma.planning.findMany({
    where: { naveId: { in: naveIds }, year, week },
  });
  const existingByNave = new Map(existingList.map((p) => [p.naveId, p]));

  if (
    existingList.some((p) => p.status === PlanningStatus.PUBLISHED) &&
    !replaceDraft
  ) {
    throw new Error(
      "El planning de esta semana está publicado en al menos una nave. Usa «Deshacer» o regenera desde el panel.",
    );
  }

  const previousAssignments = (
    await Promise.all(
      existingList.map((p) =>
        prisma.planningAssignment.findMany({ where: { planningId: p.id } }),
      ),
    )
  ).flat();

  const planFromAt = args.planFromAt ?? new Date();

  if (existingList.length > 0) {
    await prisma.planningAssignment.deleteMany({
      where: { planningId: { in: existingList.map((p) => p.id) } },
    });
  }

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
    (a, t) => a + t.hours,
    0,
  );

  if (engineInput.tasks.length === 0) {
    if (deferredHours > 0) {
      throw new Error(
        `Hay ${deferredHours.toFixed(1)}h pendientes que no pueden empezar en esta semana (tiempos de secado o cadena de procesos). Planifica una semana posterior o revisa el orden de las tareas.`,
      );
    }
    const priorHours = priorWeekAssignments.reduce((a, x) => a + x.hours, 0);
    if (priorHours > UNSCHEDULED_FAIL_THRESHOLD_HOURS) {
      throw new Error(
        "No quedan horas por planificar en esta semana: el trabajo ya está cubierto en borradores de semanas anteriores.",
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
      naveIds,
      year,
      week,
      taskCount: engineInput.tasks.length,
      solveMs: Date.now() - solveStarted,
      assignments: result.assignments.length,
    },
    "planning solver done",
  );

  assertSingleWorkerPerTask(result.assignments);

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

  const assignedTaskIds = [...new Set(result.assignments.map((a) => a.taskId))];
  const taskNaves =
    assignedTaskIds.length > 0
      ? await prisma.task.findMany({
        where: { id: { in: assignedTaskIds } },
        select: { id: true, naveId: true },
      })
      : [];
  const naveByTaskId = new Map(taskNaves.map((t) => [t.id, t.naveId]));

  const assignmentsByNave = new Map<string, typeof result.assignments>();
  for (const naveId of naveIds) {
    assignmentsByNave.set(naveId, []);
  }
  for (const assignment of result.assignments) {
    const naveId = naveByTaskId.get(assignment.taskId);
    if (!naveId) continue;
    const list = assignmentsByNave.get(naveId) ?? [];
    list.push(assignment);
    assignmentsByNave.set(naveId, list);
  }

  const plannings = await prisma.$transaction(
    async (tx) => {
      const saved: Array<{
        naveId: string;
        planningId: string;
        assignmentsCount: number;
      }> = [];

      for (const naveId of naveIds) {
        const existing = existingByNave.get(naveId);
        const naveAssignments = assignmentsByNave.get(naveId) ?? [];

        const upserted = existing
          ? await tx.planning.update({
            where: { id: existing.id },
            data: {
              status: PlanningStatus.DRAFT,
              weekStart,
              weekEnd,
              publishedAt: null,
              planningGroupId,
            },
          })
          : await tx.planning.create({
            data: {
              naveId,
              year,
              week,
              weekStart,
              weekEnd,
              planningGroupId,
            },
          });

        if (naveAssignments.length > 0) {
          await tx.planningAssignment.createMany({
            data: naveAssignments.map((a) => ({
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

        saved.push({
          naveId,
          planningId: upserted.id,
          assignmentsCount: naveAssignments.length,
        });
      }

      return saved;
    },
    { timeout: PLANNING_WRITE_TX_MS },
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

  log.info(
    {
      planningGroupId,
      plannings: plannings.map((p) => ({
        naveId: p.naveId,
        assignments: p.assignmentsCount,
      })),
      warnings: warnings.length,
    },
    "generate planning done",
  );

  return {
    planningGroupId,
    plannings,
    warnings,
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
  naveIds: string[];
  weekStart: Date;
  includeFutureWeeks?: boolean;
}): Promise<{ deletedCount: number }> {
  const weekStart = getMondayOf(args.weekStart);
  const includeFutureWeeks = args.includeFutureWeeks ?? false;
  const naveIds = [...new Set(args.naveIds)];
  const { year, week } = isoWeek(weekStart);

  const existing = await prisma.planning.findMany({
    where: {
      naveId: { in: naveIds },
      year,
      week,
    },
  });
  if (existing.length === 0) {
    throw new Error("No hay planning para esta semana.");
  }

  if (!includeFutureWeeks) {
    for (const naveId of naveIds) {
      if (await hasFuturePlannings(naveId, weekStart)) {
        throw new Error(
          "No se puede deshacer: hay plannings de semanas posteriores. Elimínalos primero o deshaz también las semanas posteriores.",
        );
      }
    }
  }

  for (const naveId of naveIds) {
    if (await hasRegistrosFromWeek(naveId, weekStart)) {
      throw new Error(
        "No se puede deshacer: hay registros de horas en esta semana o posteriores. Usa Regenerar.",
      );
    }
  }

  const deletedCount = await prisma.$transaction(
    async (tx) => {
      if (includeFutureWeeks) {
        const result = await tx.planning.deleteMany({
          where: {
            naveId: { in: naveIds },
            weekStart: { gte: weekStart },
          },
        });
        return result.count;
      }

      const result = await tx.planning.deleteMany({
        where: {
          naveId: { in: naveIds },
          year,
          week,
        },
      });
      return result.count;
    },
    { timeout: PLANNING_WRITE_TX_MS },
  );

  log.info(
    {
      naveIds,
      year,
      week,
      includeFutureWeeks,
      deletedCount,
    },
    "planning undone",
  );

  return { deletedCount };
}

export async function publishPlanningForWeek(args: {
  naveIds: string[];
  year: number;
  week: number;
}): Promise<{ publishedCount: number }> {
  const naveIds = [...new Set(args.naveIds)];
  const plannings = await prisma.planning.findMany({
    where: {
      naveId: { in: naveIds },
      year: args.year,
      week: args.week,
      status: PlanningStatus.DRAFT,
    },
    select: { id: true },
  });

  for (const planning of plannings) {
    await publishPlanning(planning.id);
  }

  return { publishedCount: plannings.length };
}

export {
  clearFutureDraftPlannings,
  hasPublishedFuturePlannings,
} from "@/features/planning/planning-horizon";

export { getMondayOf, isoWeek };
