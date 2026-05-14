import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { runScheduler } from "./engine/scheduler";
import type {
  EngineHoliday,
  EnginePerson,
  EngineTask,
  EngineAbsence,
} from "./engine/types";
import { PlanningStatus, type ProcessCode } from "@/generated/prisma";
import { getMondayOf, isoWeek, shiftWeek } from "@/lib/week";

const log = childLogger({ module: "planning.service" });

const DAY_MS = 24 * 60 * 60 * 1000;
const ENGINE_HORIZON_DAYS = 5;

/** Horas planificadas mínimas en la semana ISO anterior para poder generar la siguiente. */
export const MIN_PLANNED_HOURS_PREVIOUS_WEEK = 40;

export interface GeneratePlanningArgs {
  empresaId: string;
  weekStart: Date;
  replaceDraft?: boolean;
}

export interface GeneratedPlanning {
  planningId: string;
  warnings: string[];
  unscheduledHours: number;
  assignmentsCount: number;
}

async function assertPreviousWeekMeetsHourGate(
  empresaId: string,
  weekStartMonday: Date,
): Promise<void> {
  const prevMonday = shiftWeek(weekStartMonday, -1);
  const { year: prevYear, week: prevWeek } = isoWeek(prevMonday);

  const prevPlanning = await prisma.planning.findUnique({
    where: {
      empresaId_year_week: { empresaId, year: prevYear, week: prevWeek },
    },
    select: { id: true },
  });

  if (!prevPlanning) {
    return;
  }

  const agg = await prisma.planningAssignment.aggregate({
    where: { planningId: prevPlanning.id },
    _sum: { hours: true },
  });
  const total = agg._sum.hours ?? 0;
  if (total < MIN_PLANNED_HOURS_PREVIOUS_WEEK - 1e-6) {
    throw new Error(
      `La semana anterior (semana ${prevWeek} de ${prevYear}) tiene ${total.toFixed(1)} h planificadas. ` +
        `Hacen falta al menos ${MIN_PLANNED_HOURS_PREVIOUS_WEEK} h antes de generar esta semana.`,
    );
  }
}

export async function generatePlanning(
  args: GeneratePlanningArgs,
): Promise<GeneratedPlanning> {
  const weekStart = getMondayOf(args.weekStart);
  const weekEnd = new Date(weekStart.getTime() + (ENGINE_HORIZON_DAYS - 1) * DAY_MS);
  const { year, week } = isoWeek(weekStart);
  log.info({ empresaId: args.empresaId, year, week }, "generate planning start");

  await assertPreviousWeekMeetsHourGate(args.empresaId, weekStart);

  const [processes, peopleRaw, absencesRaw, holidaysRaw] = await Promise.all([
    prisma.processDefinition.findMany(),
    prisma.person.findMany({
      where: { isActive: true },
      include: { specialties: true },
    }),
    prisma.absence.findMany({
      where: {
        date: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
    }),
    prisma.holiday.findMany({
      where: {
        date: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
    }),
  ]);

  const enginePeople: EnginePerson[] = peopleRaw.map((p) => ({
    id: p.id,
    iniciales: p.iniciales,
    primary: p.specialties.filter((s) => s.isPrimary).map((s) => s.process),
    fallback: p.specialties
      .filter((s) => !s.isPrimary)
      .map((s) => s.process),
    capacityHours: p.capacityHours,
  }));

  const engineAbsences: EngineAbsence[] = absencesRaw.map((a) => ({
    personId: a.personId,
    date: a.date,
    hours: a.hours,
  }));

  const engineHolidays: EngineHoliday[] = holidaysRaw.map((h) => ({
    date: h.date,
  }));

  const processDefs = processes.map((p) => ({
    code: p.code,
    sequence: p.sequence,
    deadlineDay: p.deadlineDay,
  }));

  const { planning, result } = await prisma.$transaction(async (tx) => {
    const existing = await tx.planning.findUnique({
      where: {
        empresaId_year_week: { empresaId: args.empresaId, year, week },
      },
    });

    if (existing && existing.status === PlanningStatus.PUBLISHED && !args.replaceDraft) {
      throw new Error(
        "Existe un planning publicado para esta semana. Use replaceDraft para sobrescribir.",
      );
    }

    if (existing) {
      const oldSums = await tx.planningAssignment.groupBy({
        by: ["taskId"],
        where: { planningId: existing.id },
        _sum: { hours: true },
      });
      for (const row of oldSums) {
        const add = row._sum.hours ?? 0;
        if (add <= 0) continue;
        const task = await tx.task.findUnique({ where: { id: row.taskId } });
        if (!task) continue;
        await tx.task.update({
          where: { id: row.taskId },
          data: { pendingHours: task.pendingHours + add },
        });
      }
      await tx.planningAssignment.deleteMany({
        where: { planningId: existing.id },
      });
    }

    const tasks = await tx.task.findMany({
      where: {
        project: { empresaId: args.empresaId, isActive: true },
        pendingHours: { gt: 0 },
      },
      include: {
        project: {
          select: { id: true, priority: true, deliveryDate: true },
        },
      },
    });

    const engineTasks: EngineTask[] = tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      projectPriority: t.project.priority,
      projectDeliveryDate: t.project.deliveryDate ?? null,
      lampId: t.lampId,
      process: t.process,
      pendingHours: t.pendingHours,
    }));

    const result = runScheduler({
      weekStart,
      processes: processDefs,
      people: enginePeople,
      tasks: engineTasks,
      absences: engineAbsences,
      holidays: engineHolidays,
    });

    const upserted = existing
      ? await tx.planning.update({
          where: { id: existing.id },
          data: { status: PlanningStatus.DRAFT, weekStart, weekEnd, publishedAt: null },
        })
      : await tx.planning.create({
          data: {
            empresaId: args.empresaId,
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
          process: a.process as ProcessCode,
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

    return { planning: upserted, result };
  });

  log.info(
    {
      planningId: planning.id,
      assignments: result.assignments.length,
      warnings: result.warnings.length,
    },
    "generate planning done",
  );

  return {
    planningId: planning.id,
    warnings: result.warnings.map((w) => `Tarea ${w.taskId}: ${w.reason}`),
    unscheduledHours: result.unscheduledHours,
    assignmentsCount: result.assignments.length,
  };
}

export async function publishPlanning(planningId: string): Promise<void> {
  await prisma.planning.update({
    where: { id: planningId },
    data: { status: PlanningStatus.PUBLISHED, publishedAt: new Date() },
  });
}

export { getMondayOf, isoWeek };
