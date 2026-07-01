import { prisma } from "@/lib/db";
import { WorkOrderStatus } from "@/generated/prisma";

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
