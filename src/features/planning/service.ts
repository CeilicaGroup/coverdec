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
import { formatPlanningWarningMessages } from "@/features/planning/format-warnings";
import { hasRegistrosFromWeek } from "@/features/planning/planning-registros";
import { getMondayOf, isoWeek } from "@/lib/week";
import { detectPlanningPublishNotifications } from "@/features/notifications/detectors";
import { emitNotificationTx } from "@/features/notifications/service";

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

  if (existing) {
    await prisma.planningAssignment.deleteMany({ where: { planningId: existing.id } });
  }

  const priorWeekAssignments = await getPriorPlanningAssignments({
    naveId: args.naveId,
    beforeWeekStart: weekStart,
  });

  const engineInput = await loadSolverInput({
    naveId: args.naveId,
    weekStart,
    weekEnd,
    planFrom: args.planFrom,
    planFromAt,
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

  if (await hasRegistrosFromWeek(args.naveId, weekStart)) {
    throw new Error(
      "No se puede deshacer: hay registros de horas en esta semana o posteriores. Usa Regenerar.",
    );
  }

  await prisma.$transaction(
    async (tx) => {
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
