import { prisma } from "@/lib/db";
import { effectivePendingHours } from "@/features/planning/task-planning-status";
import {
  computeTaskPlanningTotals,
  loadDoneHoursByTaskIds,
} from "@/features/time-tracking/task-hours-derived";
import {
  buildPriorPlannedHoursByTaskId,
  type PriorPlanningAssignment,
} from "@/features/planning/prior-week-planning";
import { personNaveId } from "@/features/people/person-naves";
import { TRANSPORT_PROCESS_CODE } from "@/features/projects/transport-tasks";

export interface TransportOperatorCheckRow {
  id: string;
  naveId: string;
  nave: { codigo: string; nombre: string };
  project: { name: string };
  lamp: { name: string };
}

export function findTransportTasksWithoutEligibleOperator(args: {
  tasks: TransportOperatorCheckRow[];
  peopleByNave: Map<string, number>;
}): TransportOperatorCheckRow[] {
  return args.tasks.filter((task) => (args.peopleByNave.get(task.naveId) ?? 0) === 0);
}

export function formatMissingTransportOperatorError(
  tasks: TransportOperatorCheckRow[],
): string {
  const lines = tasks.map(
    (task) =>
      `· ${task.project.name} · ${task.lamp.name} · ${task.nave.codigo} · ${task.nave.nombre}`,
  );
  return [
    "No se puede generar el planning: hay transportes pendientes sin operario con especialidad TRANSPORTE en la nave origen.",
    "Asigna TRANSPORTE a un operario en Personal para:",
    ...lines,
  ].join("\n");
}

export async function assertSchedulableTransportTasksHaveOperators(args: {
  naveIds: string[];
  weekStart: Date;
  planFromAt?: Date;
  priorWeekAssignmentsByNave?: Map<string, PriorPlanningAssignment[]>;
}): Promise<void> {
  const planFromAt = args.planFromAt ?? new Date();
  const people = await prisma.person.findMany({
    where: {
      isActive: true,
      specialties: { some: { process: TRANSPORT_PROCESS_CODE } },
      personNaves: { some: { naveId: { in: args.naveIds } } },
    },
    select: {
      personNaves: { select: { naveId: true } },
    },
  });

  const peopleByNave = new Map<string, number>();
  for (const person of people) {
    const naveId = personNaveId(person);
    if (!naveId || !args.naveIds.includes(naveId)) continue;
    peopleByNave.set(naveId, (peopleByNave.get(naveId) ?? 0) + 1);
  }

  const tasksRaw = await prisma.task.findMany({
    where: {
      process: TRANSPORT_PROCESS_CODE,
      naveId: { in: args.naveIds },
      project: { isActive: true },
    },
    select: {
      id: true,
      naveId: true,
      estimatedHours: true,
      isCompleted: true,
      nave: { select: { codigo: true, nombre: true } },
      project: { select: { name: true } },
      lamp: { select: { name: true } },
    },
  });

  if (tasksRaw.length === 0) return;

  const priorPlannedHoursByTask = buildPriorPlannedHoursByTaskId(
    args.priorWeekAssignmentsByNave
      ? [...args.priorWeekAssignmentsByNave.values()].flat()
      : [],
  );
  const doneHoursByTask = await loadDoneHoursByTaskIds(
    prisma,
    tasksRaw.map((task) => task.id),
    planFromAt,
  );

  const schedulable: TransportOperatorCheckRow[] = [];
  for (const task of tasksRaw) {
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

  const missing = findTransportTasksWithoutEligibleOperator({
    tasks: schedulable,
    peopleByNave,
  });
  if (missing.length > 0) {
    throw new Error(formatMissingTransportOperatorError(missing));
  }
}
