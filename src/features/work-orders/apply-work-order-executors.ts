import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/error-message";
import { WorkOrderStatus, type Prisma } from "@/generated/prisma";
import { assertPlanningAssignmentsWorkOrderWorkers } from "./validate-planning-assignments";
import { planExecutorChanges, todayPlanningDate } from "./plan-executor-changes";

const log = childLogger({ module: "work-orders.apply-work-order-executors" });

type Db = Prisma.TransactionClient | typeof prisma;

/** El elegido ya está ocupado (otra tarea o ausencia) en las franjas de la OT. */
export class ExecutorConflictError extends Error {}

export interface ExecutorTaskRow {
  id: string;
  planningId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
  isAfternoon: boolean;
}

export interface ExecutorTask {
  id: string;
  naveId: string;
  process: string;
  assignments: ExecutorTaskRow[];
}

export async function loadOpenTasksWithAssignments(
  db: Db,
  workOrderId: string,
): Promise<ExecutorTask[]> {
  return db.task.findMany({
    where: { workOrderId, isCompleted: false },
    select: {
      id: true,
      naveId: true,
      process: true,
      assignments: {
        select: {
          id: true,
          planningId: true,
          personId: true,
          date: true,
          startSlot: true,
          endSlot: true,
          hours: true,
          process: true,
          isAfternoon: true,
        },
      },
    },
  });
}

/**
 * Solo se cambia de hoy en adelante: las franjas de días pasados son historia
 * y no se borran, copian ni cuentan para choques.
 */
export function keepAssignmentsFromToday(tasks: ExecutorTask[]): ExecutorTask[] {
  const today = todayPlanningDate().getTime();
  return tasks.map((t) => ({
    ...t,
    assignments: t.assignments.filter((a) => a.date.getTime() >= today),
  }));
}

/** Guarda la elección (el orden manda: el primero es el responsable). */
export async function saveWorkOrderExecutors(
  tx: Prisma.TransactionClient,
  workOrderId: string,
  personIds: string[],
): Promise<void> {
  await tx.workOrderExecutor.deleteMany({ where: { workOrderId } });
  await tx.workOrderExecutor.createMany({
    data: personIds.map((personId, position) => ({ workOrderId, personId, position })),
  });
}

async function assertExecutorsNotDoubleBooked(
  tx: Prisma.TransactionClient,
  personIds: string[],
  tasks: { assignments: { date: Date }[] }[],
): Promise<void> {
  const dates = [
    ...new Set(tasks.flatMap((t) => t.assignments.map((a) => a.date.getTime()))),
  ].map((ms) => new Date(ms));
  if (dates.length === 0) return;
  const rows = await tx.planningAssignment.findMany({
    where: { personId: { in: personIds }, date: { in: dates } },
    select: {
      personId: true,
      date: true,
      startSlot: true,
      endSlot: true,
      person: { select: { iniciales: true } },
    },
    orderBy: [{ personId: "asc" }, { date: "asc" }, { startSlot: "asc" }],
  });
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const row = rows[i]!;
    if (
      prev.personId === row.personId &&
      prev.date.getTime() === row.date.getTime() &&
      row.startSlot < prev.endSlot
    ) {
      throw new ExecutorConflictError(
        `${row.person.iniciales} ya tiene otra tarea planificada a esa hora el ${row.date
          .toISOString()
          .slice(0, 10)}.`,
      );
    }
  }
}

async function assertAddedExecutorsNotAbsent(
  tx: Prisma.TransactionClient,
  personIds: string[],
  dates: Date[],
): Promise<void> {
  if (personIds.length === 0 || dates.length === 0) return;
  // ponytail: cualquier ausencia ese día bloquea (también las de unas horas).
  const absence = await tx.absence.findFirst({
    where: {
      personId: { in: personIds },
      OR: dates.map((d) => ({ date: { lte: d }, endDate: { gte: d } })),
    },
    select: { date: true, person: { select: { iniciales: true } } },
  });
  if (absence) {
    throw new ExecutorConflictError(
      `${absence.person.iniciales} tiene una ausencia en los días planificados de esta OT.`,
    );
  }
}

/**
 * Copia las franjas ya planificadas a cada persona elegida. Unlike
 * requiredWorkers (chapas: synchronized, standard hours already split
 * between N people), this duplicates hours: each chosen person gets their
 * own full-hours PlanningAssignment rows, mirroring whatever slots are
 * already there — for speeding up delivery, not splitting the same work.
 * `tasks` solo trae franjas de hoy en adelante y todas tienen alguna.
 */
export async function applyExecutorsToPlannedTasks(
  tx: Prisma.TransactionClient,
  tasks: ExecutorTask[],
  personIds: string[],
): Promise<void> {
  const affectedPlanningIds = new Set<string>();
  const addedPersonIds = new Set<string>();
  const addedDates = new Map<number, Date>();

  for (const task of tasks) {
    for (const row of task.assignments) {
      affectedPlanningIds.add(row.planningId);
    }

    const plan = planExecutorChanges(task.assignments, personIds);
    const rowById = new Map(task.assignments.map((r) => [r.id, r]));

    if (plan.rowIdsToDelete.length > 0) {
      await tx.planningAssignment.deleteMany({
        where: { id: { in: plan.rowIdsToDelete } },
      });
    }

    const templateRows = plan.templateRowIds
      .map((id) => rowById.get(id))
      .filter((row): row is ExecutorTaskRow => row != null);

    for (const personId of plan.personIdsToAdd) {
      if (templateRows.length === 0) continue;
      addedPersonIds.add(personId);
      for (const row of templateRows) addedDates.set(row.date.getTime(), row.date);
      await tx.planningAssignment.createMany({
        data: templateRows.map((row) => ({
          planningId: row.planningId,
          taskId: task.id,
          personId,
          date: row.date,
          startSlot: row.startSlot,
          endSlot: row.endSlot,
          hours: row.hours,
          process: row.process,
          isAfternoon: row.isAfternoon,
          isOverride: true,
        })),
      });
    }

    // Remaining rows (kept people's, usually the solver's, and past days')
    // must be overrides too: the worker cap counts only override people, and
    // regenerating the week keeps only override rows for this task.
    await tx.planningAssignment.updateMany({
      where: { taskId: task.id, isOverride: false },
      data: { isOverride: true },
    });
  }

  for (const planningId of affectedPlanningIds) {
    await assertPlanningAssignmentsWorkOrderWorkers(tx, planningId);
  }

  // Duplicar franjas no puede poner a nadie en dos tareas a la vez ni en un día de ausencia.
  await assertExecutorsNotDoubleBooked(tx, personIds, tasks);
  await assertAddedExecutorsNotAbsent(tx, [...addedPersonIds], [...addedDates.values()]);
}

/**
 * Tras generar planning(s): aplica los operarios guardados en las OT cuyas
 * tareas acaban de recibir franjas del solver (no manuales). El responsable ya
 * llega como dueño al solver; aquí se añade el apoyo. Lo que no se pueda
 * aplicar no tumba el planning: vuelve como aviso.
 */
export async function applyStoredWorkOrderExecutors(planningIds: string[]): Promise<string[]> {
  if (planningIds.length === 0) return [];
  const workOrders = await prisma.workOrder.findMany({
    where: {
      status: WorkOrderStatus.OPEN,
      executors: { some: {} },
      tasks: {
        some: {
          isCompleted: false,
          assignments: { some: { planningId: { in: planningIds }, isOverride: false } },
        },
      },
    },
    select: {
      id: true,
      number: true,
      executors: {
        orderBy: { position: "asc" },
        select: { personId: true, person: { select: { iniciales: true } } },
      },
    },
  });

  const warnings: string[] = [];
  for (const wo of workOrders) {
    const personIds = wo.executors.map((e) => e.personId);
    const responsable = wo.executors[0]!;
    const tasks = keepAssignmentsFromToday(await loadOpenTasksWithAssignments(prisma, wo.id)).filter(
      (t) => t.assignments.length > 0,
    );
    if (tasks.some((t) => !t.assignments.some((a) => a.personId === responsable.personId))) {
      warnings.push(
        `OT ${wo.number}: no se pudo planificar con ${responsable.person.iniciales} (sin hueco o ausente); revisa sus operarios.`,
      );
      continue;
    }
    try {
      await prisma.$transaction((tx) => applyExecutorsToPlannedTasks(tx, tasks, personIds));
    } catch (err) {
      const message = getErrorMessage(err);
      log.warn({ workOrderId: wo.id, personIds, err: message }, "stored executors not applied");
      warnings.push(`OT ${wo.number}: no se aplicaron sus operarios. ${message}`);
    }
  }
  return warnings;
}
