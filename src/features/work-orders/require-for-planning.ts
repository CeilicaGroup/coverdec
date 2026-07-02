import { prisma } from "@/lib/db";
import { WorkOrderStatus } from "@/generated/prisma";
import {
  buildPriorPlannedHoursByTaskId,
  getPriorPlanningAssignments,
  type PriorPlanningAssignment,
} from "@/features/planning/prior-week-planning";
import { effectivePendingHours } from "@/features/planning/task-planning-status";
import {
  computeTaskPlanningTotals,
  loadDoneHoursByTaskIds,
} from "@/features/time-tracking/task-hours-derived";
import { getMondayOf } from "@/lib/week";
import { isWorkOrderExemptTask } from "./task-ot-exemptions";

export interface TaskWorkOrderCheckRow {
  id: string;
  workOrderId: string | null;
  workOrder: { status: WorkOrderStatus; number: string } | null;
  project: { name: string };
  lamp: { name: string };
  processDefinition: { label: string };
}

export function findTasksMissingOpenWorkOrder(
  tasks: TaskWorkOrderCheckRow[],
): TaskWorkOrderCheckRow[] {
  return tasks.filter(
    (task) =>
      !task.workOrderId || task.workOrder?.status !== WorkOrderStatus.OPEN,
  );
}

export function formatMissingWorkOrderError(
  tasks: TaskWorkOrderCheckRow[],
): string {
  const lines = tasks.map(
    (task) =>
      `· ${task.project.name} · ${task.lamp.name} · ${task.processDefinition.label}`,
  );
  return [
    "No se puede generar el planning: hay tareas planificables sin OT abierta.",
    "Crea o asigna una OT en Órdenes de trabajo para:",
    ...lines,
  ].join("\n");
}

export async function assertSchedulableTasksHaveOpenWorkOrder(
  taskIds: string[],
): Promise<void> {
  if (taskIds.length === 0) return;

  const uniqueIds = [...new Set(taskIds)];
  const tasks = await prisma.task.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      workOrderId: true,
      workOrder: { select: { status: true, number: true } },
      project: { select: { name: true } },
      lamp: { select: { name: true } },
      processDefinition: { select: { label: true } },
    },
  });

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = uniqueIds
    .map((id) => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => t != null);

  const missing = findTasksMissingOpenWorkOrder(ordered);
  if (missing.length > 0) {
    throw new Error(formatMissingWorkOrderError(missing));
  }
}

const schedulableTaskSelect = {
  id: true,
  process: true,
  systemKind: true,
  estimatedHours: true,
  isCompleted: true,
  workOrderId: true,
  workOrder: { select: { status: true, number: true } },
  project: { select: { name: true } },
  lamp: { select: { name: true } },
  processDefinition: { select: { label: true } },
} as const;

/** Falla antes de cargar el solver si hay tareas con horas pendientes sin OT abierta. */
export async function assertNaveSchedulableTasksHaveOpenWorkOrder(args: {
  naveId: string;
  weekStart: Date;
  planFromAt?: Date;
  priorWeekAssignments?: PriorPlanningAssignment[];
}): Promise<void> {
  const planFromAt = args.planFromAt ?? new Date();
  const tasksRaw = await prisma.task.findMany({
    where: {
      naveId: args.naveId,
      project: { isActive: true },
    },
    select: schedulableTaskSelect,
  });

  if (tasksRaw.length === 0) return;

  const priorPlannedHoursByTask = buildPriorPlannedHoursByTaskId(
    args.priorWeekAssignments ?? [],
  );
  const doneHoursByTask = await loadDoneHoursByTaskIds(
    prisma,
    tasksRaw.map((task) => task.id),
    planFromAt,
  );

  const schedulable: TaskWorkOrderCheckRow[] = [];
  for (const task of tasksRaw) {
    if (isWorkOrderExemptTask(task)) continue;
    const totals = computeTaskPlanningTotals({
      estimatedHours: task.estimatedHours,
      doneHours: doneHoursByTask.get(task.id) ?? 0,
      priorPlannedHours: priorPlannedHoursByTask.get(task.id) ?? 0,
    });
    const pending = effectivePendingHours(
      {
        estimatedHours: task.estimatedHours,
        isCompleted: task.isCompleted,
        pendingToPlanHours: totals.pendingToPlanHours,
        remainingWorkHours: totals.remainingWorkHours,
      },
      { priorPlannedHours: priorPlannedHoursByTask.get(task.id) ?? 0 },
    );
    if (pending <= 0) continue;
    schedulable.push(task);
  }

  const missing = findTasksMissingOpenWorkOrder(schedulable);
  if (missing.length > 0) {
    throw new Error(formatMissingWorkOrderError(missing));
  }
}

/** Valida todas las naves antes de generar planning global (evita OT parcial). */
export async function assertActiveNavesSchedulableTasksHaveOpenWorkOrder(args: {
  naveIds: string[];
  weekStart: Date;
  planFromAt?: Date;
}): Promise<void> {
  const weekStart = getMondayOf(args.weekStart);
  await Promise.all(
    args.naveIds.map(async (naveId) => {
      const priorWeekAssignments = await getPriorPlanningAssignments({
        naveId,
        beforeWeekStart: weekStart,
        includeDraftPriorWeeks: true,
      });
      await assertNaveSchedulableTasksHaveOpenWorkOrder({
        naveId,
        weekStart,
        planFromAt: args.planFromAt,
        priorWeekAssignments,
      });
    }),
  );
}
