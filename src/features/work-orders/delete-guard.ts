import type { Prisma } from "@/generated/prisma";

export async function assertWorkOrderDeletable(
  tx: Prisma.TransactionClient,
  workOrderId: string,
): Promise<void> {
  const taskIds = await tx.task.findMany({
    where: { workOrderId },
    select: { id: true },
  });
  const ids = taskIds.map((task) => task.id);
  if (ids.length === 0) return;

  const [timeEntryCount, planningAssignmentCount] = await Promise.all([
    tx.timeEntry.count({ where: { taskId: { in: ids } } }),
    tx.planningAssignment.count({ where: { taskId: { in: ids } } }),
  ]);

  if (timeEntryCount > 0) {
    throw new Error(
      "No se puede eliminar: hay registros de tiempo en tareas de esta OT.",
    );
  }

  if (planningAssignmentCount > 0) {
    throw new Error(
      "No se puede eliminar: hay tareas planificadas en esta OT.",
    );
  }
}
