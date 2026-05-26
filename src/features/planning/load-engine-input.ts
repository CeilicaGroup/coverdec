import { prisma } from "@/lib/db";
import { utcDayStart } from "@/lib/holidays";
import type { PlanningWeights } from "@/features/planning/policy-schema";
import { getPlanningWeights } from "@/features/planning/queries";
import {
  computePlanFromBounds,
  type PlanFrom,
} from "@/features/planning/plan-from";
import {
  buildLastAssignmentEndByTaskId,
  buildPriorPlannedHoursByTaskId,
  computeMinWeekQuarterByTaskId,
  type PriorPlanningAssignment,
} from "@/features/planning/prior-week-planning";
import { isSameUtcDay, toUtcDay } from "@/lib/week";
import type {
  PersonScheduleDayInput,
  PersonScheduleOverrideInput,
  WorkWindowMinutes,
} from "./engine/slots/person-schedule";
import type { SolverInput } from "./engine/solver-types";
import type {
  EngineAbsence,
  EngineBookedHours,
  EngineFixedAssignment,
  EngineHoliday,
  EnginePerson,
  EngineProcessDef,
  EngineTask,
} from "./engine/types";
import {
  AFTERNOON_START,
  MORNING_END,
  MORNING_START,
} from "./engine/types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Deriva ventanas de trabajo a partir del contrato de horas diarias.
 * Rellena primero la mañana (08:00–14:00, hasta 6h) y luego la tarde (15:00–17:00). */
function deriveWindowsFromCapacity(capacityHours: number): WorkWindowMinutes[] {
  const morningH = Math.min(capacityHours, MORNING_END - MORNING_START);
  const afternoonH = Math.max(0, capacityHours - morningH);
  const windows: WorkWindowMinutes[] = [{
    startMinutes: MORNING_START * 60,
    endMinutes: (MORNING_START + morningH) * 60,
  }];
  if (afternoonH > 0) {
    windows.push({
      startMinutes: AFTERNOON_START * 60,
      endMinutes: (AFTERNOON_START + afternoonH) * 60,
    });
  }
  return windows;
}

function isTaskDone(task: {
  pendingHours: number;
  doneHours: number;
  estimatedHours: number;
}): boolean {
  return (
    task.pendingHours <= 0 ||
    (task.estimatedHours > 0 && task.doneHours >= task.estimatedHours - 1e-6)
  );
}

function isTaskHalfDone(task: {
  pendingHours: number;
  doneHours: number;
}): boolean {
  return task.doneHours > 0 && task.pendingHours > 0;
}

/** Horas que el solver debe cubrir (pendingHours ya viene reconciliado por semana). */
export function effectivePendingHours(
  task: {
    pendingHours: number;
    doneHours: number;
    estimatedHours: number;
  },
  options?: { priorPlannedHours?: number },
): number {
  if (isTaskDone(task)) return 0;
  const remaining = Math.max(0, task.estimatedHours - task.doneHours);
  let cap = remaining;
  if (options?.priorPlannedHours != null) {
    cap = Math.min(cap, Math.max(0, remaining - options.priorPlannedHours));
  }
  return Math.min(Math.max(0, task.pendingHours), cap);
}

export function roundUpToPlanningQuarterHours(hours: number): number {
  if (hours <= 1e-6) return 0;
  return Math.ceil(hours * 4 - 1e-9) / 4;
}

export function buildPreviousHoursFromAssignments(
  assignments: { taskId: string; personId: string; date: Date; hours: number }[],
  weekStart: Date,
  excludeTaskIds?: Set<string>,
): Map<string, number> {
  const week = toUtcDay(weekStart);
  const days = Array.from({ length: 5 }, (_, i) =>
    new Date(week.getTime() + i * DAY_MS),
  );
  const previousHours = new Map<string, number>();
  for (const a of assignments) {
    if (excludeTaskIds?.has(a.taskId)) continue;
    const dayIdx = days.findIndex((d) => isSameUtcDay(d, a.date));
    if (dayIdx < 0) continue;
    const key = `${a.taskId}|${a.personId}|${dayIdx}`;
    previousHours.set(key, (previousHours.get(key) ?? 0) + a.hours);
  }
  return previousHours;
}

export function buildFixedAssignmentsFromPrevious(
  assignments: {
    taskId: string;
    personId: string;
    date: Date;
    startSlot: number;
    endSlot: number;
    hours: number;
    process: string;
  }[],
  taskById: Map<
    string,
    { pendingHours: number; doneHours: number; estimatedHours: number }
  >,
): EngineFixedAssignment[] {
  const fixed: EngineFixedAssignment[] = [];
  for (const a of assignments) {
    const task = taskById.get(a.taskId);
    if (!task || !isTaskDone(task)) continue;
    fixed.push({
      taskId: a.taskId,
      personId: a.personId,
      date: a.date,
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      hours: a.hours,
      process: a.process,
    });
  }
  return fixed;
}

export async function loadSolverInput(args: {
  naveId: string;
  weekStart: Date;
  weekEnd: Date;
  planFrom?: PlanFrom;
  planFromAt?: Date;
  previousAssignments?: {
    taskId: string;
    personId: string;
    date: Date;
    startSlot: number;
    endSlot: number;
    hours: number;
    process: string;
  }[];
  /** Asignaciones de plannings con weekStart anterior a esta semana. */
  priorWeekAssignments?: PriorPlanningAssignment[];
}): Promise<SolverInput> {
  const weekStart = toUtcDay(args.weekStart);
  const planFromAt = args.planFromAt ?? new Date();
  const planFrom = args.planFrom ?? "WEEK_START";
  const { firstSchedulableDayIndex, firstSchedulableWeekQuarter } =
    computePlanFromBounds(weekStart, planFrom, planFromAt);

  const [
    processes,
    peopleRaw,
    absencesRaw,
    holidaysRaw,
    weights,
    tasksRaw,
    timeEntriesRaw,
  ] = await Promise.all([
    prisma.processDefinition.findMany(),
    prisma.person.findMany({
      where: { naveId: args.naveId, isActive: true },
      include: {
        specialties: true,
        workWindows: true,
        scheduleOverrides: { include: { windows: true } },
      },
    }),
    prisma.absence.findMany({
      where: { date: { gte: weekStart, lte: args.weekEnd } },
    }),
    prisma.holiday.findMany({
      where: {
        AND: [
          { startDate: { lte: args.weekEnd } },
          {
            endDate: {
              gte: new Date(weekStart.getTime() - 14 * DAY_MS),
            },
          },
        ],
      },
    }),
    getPlanningWeights(args.naveId),
    prisma.task.findMany({
      where: {
        naveId: args.naveId,
        project: { isActive: true },
      },
      include: {
        project: {
          select: { id: true, deliveryDate: true },
        },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        startedAt: { gte: weekStart, lte: args.weekEnd },
        endedAt: { not: null },
      },
      include: {
        user: { select: { personId: true } },
      },
    }),
  ]);

  const taskById = new Map(tasksRaw.map((t) => [t.id, t]));
  const processCanFragment = new Map(processes.map((p) => [p.code, p.canFragment]));
  const halfDoneIds = new Set(
    tasksRaw.filter(isTaskHalfDone).map((t) => t.id),
  );

  const fixedAssignments = buildFixedAssignmentsFromPrevious(
    args.previousAssignments ?? [],
    taskById,
  );

  const bookedByKey = new Map<string, number>();
  for (const e of timeEntriesRaw) {
    const personId = e.user.personId;
    if (!personId) continue;
    const dayKey = toUtcDay(e.startedAt).toISOString().slice(0, 10);
    const key = `${personId}|${dayKey}`;
    bookedByKey.set(key, (bookedByKey.get(key) ?? 0) + (e.hours ?? 0));
  }

  const bookedHours: EngineBookedHours[] = [];
  for (const [key, hours] of bookedByKey) {
    if (hours <= 0) continue;
    const [personId, dateIso] = key.split("|");
    bookedHours.push({
      personId: personId!,
      date: new Date(`${dateIso}T00:00:00.000Z`),
      hours,
    });
  }

  const weeklyByPerson = new Map<string, PersonScheduleDayInput[]>();
  const overridesByPerson = new Map<string, PersonScheduleOverrideInput[]>();

  for (const p of peopleRaw) {
    if (p.workWindows.length > 0) {
      const byDay = new Map<number, PersonScheduleDayInput["windows"]>();
      for (const w of p.workWindows) {
        const list = byDay.get(w.dayOfWeek) ?? [];
        list.push({ startMinutes: w.startMinutes, endMinutes: w.endMinutes });
        byDay.set(w.dayOfWeek, list);
      }
      weeklyByPerson.set(
        p.id,
        [...byDay.entries()].map(([dayOfWeek, windows]) => ({
          dayOfWeek,
          windows: windows.sort((a, b) => a.startMinutes - b.startMinutes),
        })),
      );
    } else {
      // Sin workWindows explícitas: derivar de capacityHours para que el solver
      // respete la jornada real (ej: mañana-sólo si capacityHours=6).
      const windows = deriveWindowsFromCapacity(p.capacityHours);
      weeklyByPerson.set(
        p.id,
        [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, windows })),
      );
    }
    if (p.scheduleOverrides.length > 0) {
      overridesByPerson.set(
        p.id,
        p.scheduleOverrides.map((o) => ({
          date: o.date,
          windows: o.windows.map((w) => ({
            startMinutes: w.startMinutes,
            endMinutes: w.endMinutes,
          })),
        })),
      );
    }
  }

  const enginePeople: EnginePerson[] = peopleRaw.map((p) => ({
    id: p.id,
    iniciales: p.iniciales,
    primary: p.specialties.filter((s) => s.isPrimary).map((s) => s.process),
    fallback: p.specialties
      .filter((s) => !s.isPrimary)
      .map((s) => s.process),
    capacityHours: p.capacityHours,
    hourlyRate: Number(p.hourlyRate),
    overtimeHourlyRate: Number(p.overtimeHourlyRate),
  }));

  const priorPlannedHoursByTask = buildPriorPlannedHoursByTaskId(
    args.priorWeekAssignments ?? [],
  );

  const engineTasksBase = tasksRaw
    .map((t) => ({
      task: t,
      pending: effectivePendingHours(t, {
        priorPlannedHours: priorPlannedHoursByTask.get(t.id) ?? 0,
      }),
    }))
    .filter(({ pending }) => pending > 0)
    .map(({ task: t, pending }) => ({
      id: t.id,
      projectId: t.projectId,
      projectDeliveryDate: t.project.deliveryDate ?? null,
      lampId: t.lampId,
      order: t.order,
      process: t.process,
      pendingHours: pending,
      canFragment: processCanFragment.get(t.process) ?? true,
    }));

  const holidayDates = new Set<string>();
  for (const h of holidaysRaw) {
    let t = utcDayStart(h.startDate).getTime();
    const endT = utcDayStart(h.endDate).getTime();
    while (t <= endT) {
      holidayDates.add(new Date(t).toISOString().slice(0, 10));
      t += DAY_MS;
    }
  }

  const engineTaskIds = new Set(engineTasksBase.map((t) => t.id));
  const priorEnds = buildLastAssignmentEndByTaskId(
    args.priorWeekAssignments ?? [],
  );
  const { minByTask: minWeekQuarterByTask, deferredPastHorizon } =
    computeMinWeekQuarterByTaskId({
      weekStart,
      tasks: tasksRaw,
      engineTaskIds,
      priorEnds,
      waitHoursByProcess: new Map(
        processes.map((p) => [p.code, p.waitHours]),
      ),
      holidayDates,
    });

  const engineTasks: EngineTask[] = engineTasksBase
    .filter((t) => !deferredPastHorizon.has(t.id))
    .map((t) => {
      const minWeekQuarter = minWeekQuarterByTask.get(t.id);
      const pendingHours = roundUpToPlanningQuarterHours(t.pendingHours);
      return minWeekQuarter !== undefined
        ? { ...t, pendingHours, minWeekQuarter }
        : { ...t, pendingHours };
    });

  const processDefs: EngineProcessDef[] = processes.map((p) => ({
    code: p.code,
    waitHours: p.waitHours,
  }));

  const engineAbsences: EngineAbsence[] = absencesRaw.map((a) => ({
    personId: a.personId,
    date: a.date,
    hours: a.hours,
    blockStartMinutes: a.blockStartMinutes,
    blockEndMinutes: a.blockEndMinutes,
  }));

  const engineHolidays: EngineHoliday[] = [];
  const seenHolidayDays = new Set<string>();
  for (const h of holidaysRaw) {
    let t = utcDayStart(h.startDate).getTime();
    const endT = utcDayStart(h.endDate).getTime();
    const ws = weekStart.getTime();
    const we = utcDayStart(args.weekEnd).getTime();
    while (t <= endT) {
      if (t >= ws && t <= we) {
        const key = new Date(t).toISOString().slice(0, 10);
        if (!seenHolidayDays.has(key)) {
          seenHolidayDays.add(key);
          engineHolidays.push({ date: new Date(t) });
        }
      }
      t += DAY_MS;
    }
  }

  const deferredTasks = engineTasksBase
    .filter((t) => deferredPastHorizon.has(t.id))
    .map((t) => ({ taskId: t.id, hours: t.pendingHours }));

  const input: SolverInput = {
    weekStart,
    processes: processDefs,
    people: enginePeople,
    tasks: engineTasks,
    absences: engineAbsences,
    holidays: engineHolidays,
    weights,
    weeklyByPerson,
    overridesByPerson,
    firstSchedulableDayIndex,
    firstSchedulableWeekQuarter,
    fixedAssignments,
    bookedHours,
    deferredTasks,
  };

  if (args.previousAssignments && args.previousAssignments.length > 0) {
    input.previousHours = buildPreviousHoursFromAssignments(
      args.previousAssignments,
      weekStart,
      halfDoneIds,
    );
  }

  return input;
}

export type { PlanningWeights };
