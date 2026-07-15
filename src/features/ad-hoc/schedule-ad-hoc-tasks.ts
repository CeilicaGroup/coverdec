import { PlanningStatus, TaskSystemKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { utcDayStart } from "@/lib/holidays";
import { PRODUCTIVE_SLOTS_PER_DAY } from "@/features/planning/engine/slot-format";
import type { OverrideAssignmentSlice } from "@/features/planning/planning-override-preserve";
import { getMondayOf, isSameUtcDay, isoWeek } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_STEP = 0.25;

export interface OccupiedAssignmentSlice {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
}

export interface PendingAdHocTaskForScheduling {
  id: string;
  process: string;
  estimatedHours: number;
  participantIds: string[];
}

export interface ScheduleAdHocTasksArgs {
  naveId: string;
  weekStart: Date;
  firstSchedulableDayIndex: number;
  occupied: OccupiedAssignmentSlice[];
  alreadyPlannedTaskIds: Set<string>;
  onlyTaskIds?: Set<string>;
}

function roundSlot(value: number): number {
  return Math.round(value * 100) / 100;
}

function candidateStartSlots(hours: number): number[] {
  const slots: number[] = [];
  const maxStart = PRODUCTIVE_SLOTS_PER_DAY - hours;
  for (let slot = 0; slot <= maxStart + 1e-9; slot += SLOT_STEP) {
    slots.push(roundSlot(slot));
  }
  return slots;
}

function schedulableDates(weekStart: Date, firstSchedulableDayIndex: number): Date[] {
  return Array.from({ length: 5 - firstSchedulableDayIndex }, (_, index) =>
    utcDayStart(new Date(weekStart.getTime() + (firstSchedulableDayIndex + index) * DAY_MS)),
  );
}

function overlaps(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean {
  return startA < endB && endA > startB;
}

function personFitsSlot(args: {
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  occupied: OccupiedAssignmentSlice[];
}): boolean {
  for (const assignment of args.occupied) {
    if (assignment.personId !== args.personId) continue;
    if (!isSameUtcDay(assignment.date, args.date)) continue;
    if (
      overlaps(
        args.startSlot,
        args.endSlot,
        assignment.startSlot,
        assignment.endSlot,
      )
    ) {
      return false;
    }
  }
  return true;
}

function findCommonSlot(args: {
  personIds: string[];
  date: Date;
  estimatedHours: number;
  occupied: OccupiedAssignmentSlice[];
}): { startSlot: number; endSlot: number } | null {
  for (const startSlot of candidateStartSlots(args.estimatedHours)) {
    const endSlot = Math.min(
      roundSlot(startSlot + args.estimatedHours),
      PRODUCTIVE_SLOTS_PER_DAY,
    );
    const allFit = args.personIds.every((personId) =>
      personFitsSlot({
        personId,
        date: args.date,
        startSlot,
        endSlot,
        occupied: args.occupied,
      }),
    );
    if (allFit) return { startSlot, endSlot };
  }
  return null;
}

export function firstSchedulableDayIndexFromToday(weekStart: Date): number {
  const today = utcDayStart(new Date());
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const day = utcDayStart(new Date(weekStart.getTime() + dayIndex * DAY_MS));
    if (day.getTime() >= today.getTime()) return dayIndex;
  }
  return 5;
}

export async function countSchedulableAdHocTasksForNaves(
  naveIds: string[],
): Promise<number> {
  const uniqueNaveIds = [...new Set(naveIds)];
  if (uniqueNaveIds.length === 0) return 0;

  return prisma.task.count({
    where: {
      naveId: { in: uniqueNaveIds },
      systemKind: TaskSystemKind.AD_HOC,
      isCompleted: false,
      estimatedHours: { gt: 0 },
      participants: { some: {} },
    },
  });
}

export async function loadAdHocNaveIdByTaskId(
  taskIds: string[],
): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map();

  const rows = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      systemKind: TaskSystemKind.AD_HOC,
    },
    select: { id: true, naveId: true },
  });

  return new Map(rows.map((row) => [row.id, row.naveId]));
}

export async function loadPendingAdHocTasksForScheduling(
  naveId: string,
): Promise<PendingAdHocTaskForScheduling[]> {
  const tasks = await prisma.task.findMany({
    where: {
      naveId,
      systemKind: TaskSystemKind.AD_HOC,
      isCompleted: false,
      estimatedHours: { gt: 0 },
    },
    select: {
      id: true,
      process: true,
      estimatedHours: true,
      participants: { select: { personId: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return tasks
    .filter((task) => task.participants.length > 0)
    .map((task) => ({
      id: task.id,
      process: task.process,
      estimatedHours: task.estimatedHours,
      participantIds: task.participants.map((row) => row.personId),
    }));
}

export function schedulePendingAdHocTasks(
  pendingTasks: PendingAdHocTaskForScheduling[],
  args: ScheduleAdHocTasksArgs,
): OverrideAssignmentSlice[] {
  const scheduled: OverrideAssignmentSlice[] = [];
  const occupied = [...args.occupied];

  for (const task of pendingTasks) {
    if (args.onlyTaskIds && !args.onlyTaskIds.has(task.id)) continue;
    if (args.alreadyPlannedTaskIds.has(task.id)) continue;
    if (task.participantIds.length === 0) continue;

    let placed = false;
    for (const date of schedulableDates(args.weekStart, args.firstSchedulableDayIndex)) {
      const slot = findCommonSlot({
        personIds: task.participantIds,
        date,
        estimatedHours: task.estimatedHours,
        occupied,
      });
      if (!slot) continue;

      const isAfternoon = slot.startSlot >= 6;
      for (const personId of task.participantIds) {
        const assignment: OverrideAssignmentSlice = {
          taskId: task.id,
          personId,
          date,
          startSlot: slot.startSlot,
          endSlot: slot.endSlot,
          hours: task.estimatedHours,
          process: task.process,
          isAfternoon,
        };
        scheduled.push(assignment);
        occupied.push(assignment);
      }
      placed = true;
      break;
    }

    if (!placed) {
      // Leave unscheduled; visible as pending until next regeneration.
      continue;
    }
  }

  return scheduled;
}

export async function buildAdHocPlanningAssignmentsForNave(
  args: ScheduleAdHocTasksArgs,
): Promise<OverrideAssignmentSlice[]> {
  const pendingTasks = await loadPendingAdHocTasksForScheduling(args.naveId);
  return schedulePendingAdHocTasks(pendingTasks, args);
}

export async function buildAdHocPlanningAssignmentsForNaves(args: {
  naveIds: string[];
  weekStart: Date;
  firstSchedulableDayIndex: number;
  occupied: OccupiedAssignmentSlice[];
  alreadyPlannedTaskIds: Set<string>;
}): Promise<OverrideAssignmentSlice[]> {
  const scheduled: OverrideAssignmentSlice[] = [];
  const occupied = [...args.occupied];
  const alreadyPlannedTaskIds = new Set(args.alreadyPlannedTaskIds);

  for (const naveId of args.naveIds) {
    const batch = await buildAdHocPlanningAssignmentsForNave({
      naveId,
      weekStart: args.weekStart,
      firstSchedulableDayIndex: args.firstSchedulableDayIndex,
      occupied,
      alreadyPlannedTaskIds,
    });
    scheduled.push(...batch);
    occupied.push(...batch);
    for (const assignment of batch) {
      alreadyPlannedTaskIds.add(assignment.taskId);
    }
  }

  return scheduled;
}

export async function injectPendingAdHocIntoDraftPlanning(args: {
  naveId: string;
  taskIds?: string[];
}): Promise<{ scheduledCount: number }> {
  const weekStart = getMondayOf(new Date());
  const { year, week } = isoWeek(weekStart);

  const planning = await prisma.planning.findUnique({
    where: { naveId_year_week: { naveId: args.naveId, year, week } },
    select: { id: true, status: true, weekStart: true },
  });
  if (!planning || planning.status !== PlanningStatus.DRAFT) {
    return { scheduledCount: 0 };
  }

  const existing = await prisma.planningAssignment.findMany({
    where: { planningId: planning.id },
    select: {
      taskId: true,
      personId: true,
      date: true,
      startSlot: true,
      endSlot: true,
    },
  });

  const alreadyPlannedTaskIds = new Set(existing.map((row) => row.taskId));
  const firstSchedulableDayIndex = firstSchedulableDayIndexFromToday(planning.weekStart);
  if (firstSchedulableDayIndex >= 5) return { scheduledCount: 0 };

  const pendingTasks = await loadPendingAdHocTasksForScheduling(args.naveId);
  const scheduled = schedulePendingAdHocTasks(pendingTasks, {
    naveId: args.naveId,
    weekStart: planning.weekStart,
    firstSchedulableDayIndex,
    occupied: existing,
    alreadyPlannedTaskIds,
    onlyTaskIds: args.taskIds ? new Set(args.taskIds) : undefined,
  });

  if (scheduled.length === 0) return { scheduledCount: 0 };

  await prisma.planningAssignment.createMany({
    data: scheduled.map((assignment) => ({
      planningId: planning.id,
      taskId: assignment.taskId,
      personId: assignment.personId,
      date: assignment.date,
      startSlot: assignment.startSlot,
      endSlot: assignment.endSlot,
      hours: assignment.hours,
      process: assignment.process,
      isOverride: true,
      isAfternoon: assignment.isAfternoon,
    })),
  });

  return { scheduledCount: new Set(scheduled.map((row) => row.taskId)).size };
}
