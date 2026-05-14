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

const log = childLogger({ module: "planning.service" });

const DAY_MS = 24 * 60 * 60 * 1000;
const ENGINE_HORIZON_DAYS = 5;

function toUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function getMondayOf(date: Date): Date {
  const utc = toUtcMidnight(date);
  const dow = utc.getUTCDay() === 0 ? 7 : utc.getUTCDay();
  return new Date(utc.getTime() - (dow - 1) * DAY_MS);
}

function isoWeek(date: Date): { year: number; week: number } {
  const target = toUtcMidnight(date);
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(firstThursday, 0, 4));
  const dayDiff = (target.getTime() - yearStart.getTime()) / DAY_MS;
  const week = 1 + Math.floor(dayDiff / 7);
  return { year: firstThursday, week };
}

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

export async function generatePlanning(
  args: GeneratePlanningArgs,
): Promise<GeneratedPlanning> {
  const weekStart = getMondayOf(args.weekStart);
  const weekEnd = new Date(weekStart.getTime() + (ENGINE_HORIZON_DAYS - 1) * DAY_MS);
  const { year, week } = isoWeek(weekStart);
  log.info({ empresaId: args.empresaId, year, week }, "generate planning start");

  const [tasks, processes, peopleRaw, absencesRaw, holidaysRaw] = await Promise.all([
    prisma.task.findMany({
      where: {
        project: { empresaId: args.empresaId, isActive: true },
        pendingHours: { gt: 0 },
      },
      include: {
        project: {
          select: { id: true, priority: true, deliveryDate: true },
        },
      },
    }),
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

  const engineTasks: EngineTask[] = tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    projectPriority: t.project.priority,
    projectDeliveryDate: t.project.deliveryDate ?? null,
    lampId: t.lampId,
    process: t.process,
    pendingHours: t.pendingHours,
  }));

  const engineAbsences: EngineAbsence[] = absencesRaw.map((a) => ({
    personId: a.personId,
    date: a.date,
    hours: a.hours,
  }));

  const engineHolidays: EngineHoliday[] = holidaysRaw.map((h) => ({
    date: h.date,
  }));

  const result = runScheduler({
    weekStart,
    processes: processes.map((p) => ({
      code: p.code,
      sequence: p.sequence,
      deadlineDay: p.deadlineDay,
    })),
    people: enginePeople,
    tasks: engineTasks,
    absences: engineAbsences,
    holidays: engineHolidays,
  });

  const planning = await prisma.$transaction(async (tx) => {
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
      await tx.planningAssignment.deleteMany({
        where: { planningId: existing.id },
      });
    }

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

    return upserted;
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
