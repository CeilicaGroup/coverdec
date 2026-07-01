import type { EngineTask } from "@/features/planning/engine/types";

export interface WorkOrderOwnerConflict {
  workOrderId: string;
  workOrderNumber: string;
  personIds: string[];
}

interface WorkOrderTaskRef {
  id: string;
  workOrderId?: string | null;
  workOrderSequence?: number | null;
  workOrder?: { number?: string; status?: string } | null;
}

function workOrderNumberFor(task: WorkOrderTaskRef, workOrderId: string): string {
  return task.workOrder?.number ?? workOrderId;
}

function tasksByOpenWorkOrder<T extends WorkOrderTaskRef>(tasks: T[]): Map<string, T[]> {
  const byWorkOrder = new Map<string, T[]>();
  for (const task of tasks) {
    if (!task.workOrderId) continue;
    if (task.workOrder?.status === "CLOSED") continue;
    const list = byWorkOrder.get(task.workOrderId) ?? [];
    list.push(task);
    byWorkOrder.set(task.workOrderId, list);
  }
  for (const group of byWorkOrder.values()) {
    group.sort(
      (a, b) => (a.workOrderSequence ?? 0) - (b.workOrderSequence ?? 0),
    );
  }
  return byWorkOrder;
}

/** Detecta OT con más de un operario ya fijado (planning previo o fichajes). */
export function findWorkOrderOwnerConflicts(
  tasks: WorkOrderTaskRef[],
  ownerByTask: Map<string, string>,
): WorkOrderOwnerConflict[] {
  const conflicts: WorkOrderOwnerConflict[] = [];

  for (const [workOrderId, group] of tasksByOpenWorkOrder(tasks)) {
    const personIds = new Set<string>();
    for (const task of group) {
      const owner = ownerByTask.get(task.id);
      if (owner) personIds.add(owner);
    }
    if (personIds.size <= 1) continue;
    conflicts.push({
      workOrderId,
      workOrderNumber: workOrderNumberFor(group[0]!, workOrderId),
      personIds: [...personIds].sort(),
    });
  }

  return conflicts;
}

export function assertConsistentWorkOrderOwners(
  tasks: WorkOrderTaskRef[],
  ownerByTask: Map<string, string>,
): void {
  const conflicts = findWorkOrderOwnerConflicts(tasks, ownerByTask);
  if (conflicts.length === 0) return;

  const lines = conflicts.map(
    (c) =>
      `· ${c.workOrderNumber}: operarios ${c.personIds.join(", ")}`,
  );
  throw new Error(
    [
      "Hay órdenes de trabajo con operarios distintos ya asignados.",
      "Todas las tareas de una OT deben compartir el mismo operario:",
      ...lines,
    ].join("\n"),
  );
}

/**
 * Si alguna tarea de la OT ya tiene operario, fijarlo para todas
 * (prioriza la tarea con menor workOrderSequence que tenga operario).
 */
export function propagateWorkOrderOwnerByTaskId(
  tasks: WorkOrderTaskRef[],
  ownerByTask: Map<string, string>,
): Map<string, string> {
  const result = new Map(ownerByTask);

  for (const group of tasksByOpenWorkOrder(tasks).values()) {
    let sharedOwner: string | undefined;
    for (const task of group) {
      const owner = result.get(task.id);
      if (owner) {
        sharedOwner = owner;
        break;
      }
    }
    if (!sharedOwner) continue;
    for (const task of group) {
      result.set(task.id, sharedOwner);
    }
  }

  return result;
}

export function openWorkOrderFields(task: WorkOrderTaskRef): Pick<
  EngineTask,
  "workOrderId" | "workOrderSequence"
> {
  if (!task.workOrderId || task.workOrder?.status !== "OPEN") {
    return { workOrderId: null, workOrderSequence: null };
  }
  return {
    workOrderId: task.workOrderId,
    workOrderSequence: task.workOrderSequence ?? 0,
  };
}

export function buildWorkOrderIdByTaskId(
  tasks: Array<{
    id: string;
    workOrderId?: string | null;
    workOrder?: { status?: string } | null;
  }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const task of tasks) {
    if (!task.workOrderId) continue;
    if (task.workOrder?.status === "CLOSED") continue;
    map.set(task.id, task.workOrderId);
  }
  return map;
}
