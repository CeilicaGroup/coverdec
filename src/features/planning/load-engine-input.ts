import { prisma } from "@/lib/db";
import { utcDayStart } from "@/lib/holidays";
import type { PlanningWeights } from "@/features/planning/policy-schema";
import { getPlanningWeights } from "@/features/planning/queries";
import { projectStrategyToWeights } from "@/features/planning/policy-schema";
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
import { isSameUtcDay, isoWeek, toUtcDay } from "@/lib/week";
import {
  defaultWeeklyTemplate,
  minutesToProductiveQuarters,
} from "./engine/slots/person-schedule";
import type {
  PersonScheduleDayInput,
  PersonScheduleOverrideInput,
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
import { resolveTimeEntryHours } from "@/features/time-tracking/entry-hours";
import {
  computeTaskPlanningTotals,
  loadDoneHoursByTaskIds,
} from "@/features/time-tracking/task-hours-derived";
import {
  effectivePendingHours,
  isTaskClosedForPlanning,
} from "./task-planning-status";

export { effectivePendingHours } from "./task-planning-status";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PlanningAssignmentSlice {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
}

export function assignmentDayIndex(weekStart: Date, date: Date): number {
  const week = toUtcDay(weekStart);
  const days = Array.from({ length: 5 }, (_, i) =>
    new Date(week.getTime() + i * DAY_MS),
  );
  return days.findIndex((d) => isSameUtcDay(d, date));
}

export function partitionAssignmentsByPlanFrom(
  assignments: PlanningAssignmentSlice[],
  weekStart: Date,
  firstSchedulableDayIndex: number,
): { beforeAnchor: PlanningAssignmentSlice[]; fromAnchor: PlanningAssignmentSlice[] } {
  const beforeAnchor: PlanningAssignmentSlice[] = [];
  const fromAnchor: PlanningAssignmentSlice[] = [];
  for (const a of assignments) {
    const dayIdx = assignmentDayIndex(weekStart, a.date);
    if (dayIdx < 0) continue;
    if (dayIdx < firstSchedulableDayIndex) {
      beforeAnchor.push(a);
    } else {
      fromAnchor.push(a);
    }
  }
  return { beforeAnchor, fromAnchor };
}

function fixedAssignmentKey(a: PlanningAssignmentSlice): string {
  return `${a.taskId}|${a.personId}|${a.date.toISOString()}|${a.startSlot}`;
}

/** Fija asignaciones de tareas cerradas y de días anteriores al ancla al regenerar. */
export function buildFixedAssignmentsForRegenerate(
  assignments: PlanningAssignmentSlice[],
  taskById: Map<
    string,
    {
      pendingToPlanHours: number;
      remainingWorkHours: number;
      estimatedHours: number;
      isCompleted: boolean;
    }
  >,
  weekStart: Date,
  firstSchedulableDayIndex: number,
): EngineFixedAssignment[] {
  const seen = new Set<string>();
  const fixed: EngineFixedAssignment[] = [];

  const push = (a: PlanningAssignmentSlice) => {
    const key = fixedAssignmentKey(a);
    if (seen.has(key)) return;
    seen.add(key);
    fixed.push({
      taskId: a.taskId,
      personId: a.personId,
      date: a.date,
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      hours: a.hours,
      process: a.process,
    });
  };

  for (const a of assignments) {
    const task = taskById.get(a.taskId);
    if (!task) continue;
    if (isTaskClosedForPlanning(task)) {
      push(a);
      continue;
    }
    const dayIdx = assignmentDayIndex(weekStart, a.date);
    if (dayIdx >= 0 && dayIdx < firstSchedulableDayIndex) {
      push(a);
    }
  }

  return fixed;
}

function isTaskHalfDone(task: {
  pendingToPlanHours: number;
  remainingWorkHours: number;
  estimatedHours: number;
  isCompleted: boolean;
}): boolean {
  return (
    !isTaskClosedForPlanning(task) &&
    task.pendingToPlanHours > 0 &&
    task.remainingWorkHours > task.pendingToPlanHours
  );
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
    {
      pendingToPlanHours: number;
      remainingWorkHours: number;
      estimatedHours: number;
      isCompleted: boolean;
    }
  >,
): EngineFixedAssignment[] {
  const fixed: EngineFixedAssignment[] = [];
  for (const a of assignments) {
    const task = taskById.get(a.taskId);
    if (!task || !isTaskClosedForPlanning(task)) continue;
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

  const { year, week } = isoWeek(weekStart);

  const [
    processes,
    peopleRaw,
    absencesRaw,
    holidaysRaw,
    weights,
    tasksRaw,
    timeEntriesRaw,
    crossNaveAssignments,
    planningPolicy,
  ] = await Promise.all([
    prisma.processDefinition.findMany(),
    prisma.person.findMany({
      where: {
        isActive: true,
        personNaves: { some: { naveId: args.naveId } },
      },
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
          select: {
            id: true,
            deliveryDate: true,
            planningPreset: true,
            planningCostPriority: true,
            planningStability: true,
            planningDeadlineBoost: true,
          },
        },
      },
    }),
    prisma.timeEntry.findMany({
      where: {
        startedAt: { gte: weekStart, lte: args.weekEnd },
        user: {
          personId: { not: null },
          person: { personNaves: { some: { naveId: args.naveId } } },
        },
      },
      include: {
        user: { select: { personId: true } },
      },
    }),
    prisma.planningAssignment.findMany({
      where: {
        planning: {
          naveId: { not: args.naveId },
          year,
          week,
        },
      },
      select: {
        personId: true,
        date: true,
        startSlot: true,
        endSlot: true,
        hours: true,
      },
    }),
    prisma.planningPolicy.findUnique({
      where: { naveId: args.naveId },
      select: {
        deadlineCurveExponent: true,
        overduePenaltyMultiplier: true,
      },
    }),
  ]);

  const personIds = new Set(peopleRaw.map((p) => p.id));
  const busySlots = crossNaveAssignments
    .filter((a) => personIds.has(a.personId))
    .map((a) => ({
      personId: a.personId,
      date: a.date,
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      hours: a.hours,
    }));

  const doneHoursByTask = await loadDoneHoursByTaskIds(
    prisma,
    tasksRaw.map((task) => task.id),
    planFromAt,
  );
  const priorPlannedHoursByTask = buildPriorPlannedHoursByTaskId(
    args.priorWeekAssignments ?? [],
  );
  const planningTotalsByTaskId = new Map(
    tasksRaw.map((task) => [
      task.id,
      computeTaskPlanningTotals({
        estimatedHours: task.estimatedHours,
        doneHours: doneHoursByTask.get(task.id) ?? 0,
        priorPlannedHours: priorPlannedHoursByTask.get(task.id) ?? 0,
      }),
    ]),
  );
  const taskById = new Map(
    tasksRaw.map((task) => [
      task.id,
      {
        estimatedHours: task.estimatedHours,
        isCompleted: task.isCompleted,
        pendingToPlanHours: planningTotalsByTaskId.get(task.id)?.pendingToPlanHours ?? 0,
        remainingWorkHours: planningTotalsByTaskId.get(task.id)?.remainingWorkHours ?? 0,
      },
    ]),
  );
  const processCanFragment = new Map(processes.map((p) => [p.code, p.canFragment]));
  const halfDoneIds = new Set(
    tasksRaw
      .map((task) => {
        const totals = planningTotalsByTaskId.get(task.id);
        if (!totals) return null;
        return {
          estimatedHours: task.estimatedHours,
          isCompleted: task.isCompleted,
          pendingToPlanHours: totals.pendingToPlanHours,
          remainingWorkHours: totals.remainingWorkHours,
          id: task.id,
        };
      })
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .filter(isTaskHalfDone)
      .map((task) => task.id),
  );

  const fixedAssignments = buildFixedAssignmentsForRegenerate(
    args.previousAssignments ?? [],
    taskById,
    weekStart,
    firstSchedulableDayIndex,
  );

  const { fromAnchor: assignmentsForStability } = partitionAssignmentsByPlanFrom(
    args.previousAssignments ?? [],
    weekStart,
    firstSchedulableDayIndex,
  );

  const bookedByKey = new Map<string, number>();
  for (const e of timeEntriesRaw) {
    const personId = e.user.personId;
    if (!personId) continue;
    const dayKey = toUtcDay(e.startedAt).toISOString().slice(0, 10);
    const key = `${personId}|${dayKey}`;
    const hours = resolveTimeEntryHours(e, planFromAt);
    bookedByKey.set(key, (bookedByKey.get(key) ?? 0) + hours);
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
      weeklyByPerson.set(p.id, defaultWeeklyTemplate());
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

  const enginePeople: EnginePerson[] = peopleRaw.map((p) => {
    const weekly = weeklyByPerson.get(p.id) ?? defaultWeeklyTemplate();
    const totalHours = weekly.reduce(
      (acc, day) => acc + minutesToProductiveQuarters(day.windows) / 4,
      0,
    );
    const capacityHours = totalHours > 0 ? totalHours / 5 : 8;
    return {
      id: p.id,
      iniciales: p.iniciales,
      primary: p.specialties.filter((s) => s.isPrimary).map((s) => s.process),
      fallback: p.specialties
        .filter((s) => !s.isPrimary)
        .map((s) => s.process),
      capacityHours,
      hourlyRate: Number(p.hourlyRate),
      overtimeHourlyRate: Number(p.overtimeHourlyRate),
    };
  });

  const engineTasksBase = tasksRaw
    .map((t) => ({
      task: {
        ...t,
        pendingToPlanHours:
          planningTotalsByTaskId.get(t.id)?.pendingToPlanHours ?? 0,
        remainingWorkHours:
          planningTotalsByTaskId.get(t.id)?.remainingWorkHours ?? 0,
      },
      pending: effectivePendingHours(
        {
          estimatedHours: t.estimatedHours,
          isCompleted: t.isCompleted,
          pendingToPlanHours:
            planningTotalsByTaskId.get(t.id)?.pendingToPlanHours ?? 0,
          remainingWorkHours:
            planningTotalsByTaskId.get(t.id)?.remainingWorkHours ?? 0,
        },
        {
        priorPlannedHours: priorPlannedHoursByTask.get(t.id) ?? 0,
        },
      ),
    }))
    .filter(({ pending }) => pending > 0)
    .map(({ task: t, pending }) => {
      const projectWeights = projectStrategyToWeights({
        preset: t.project.planningPreset,
        costPriority: t.project.planningCostPriority,
        stability: t.project.planningStability,
        deadlineBoost: t.project.planningDeadlineBoost,
      });
      return {
      id: t.id,
      projectId: t.projectId,
      projectPriority: Math.round((projectWeights.wPriority / 5) * 100),
      deadlineCurveExponent: planningPolicy?.deadlineCurveExponent ?? 2,
      overduePenaltyMultiplier: planningPolicy?.overduePenaltyMultiplier ?? 2.5,
      projectDeliveryDate: t.project.deliveryDate ?? null,
      lampId: t.lampId,
      order: t.order,
      process: t.process,
      pendingHours: pending,
      canFragment: processCanFragment.get(t.process) ?? true,
      };
    });

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
      tasks: tasksRaw.map((task) => ({
        id: task.id,
        lampId: task.lampId,
        order: task.order,
        process: task.process,
        estimatedHours: task.estimatedHours,
        pendingToPlanHours:
          planningTotalsByTaskId.get(task.id)?.pendingToPlanHours ?? 0,
        remainingWorkHours:
          planningTotalsByTaskId.get(task.id)?.remainingWorkHours ?? 0,
      })),
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
    busySlots,
    deferredTasks,
    planFrom,
  };

  if (assignmentsForStability.length > 0) {
    input.previousHours = buildPreviousHoursFromAssignments(
      assignmentsForStability,
      weekStart,
      halfDoneIds,
    );
  }

  return input;
}

export type { PlanningWeights };
