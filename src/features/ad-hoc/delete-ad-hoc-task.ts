import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";

export const AD_HOC_DELETE_NOT_AD_HOC_ERROR =
  "Solo se pueden eliminar tareas imprevistas.";

export const AD_HOC_DELETE_HAS_TIME_ENTRIES_ERROR =
  "No se puede eliminar: la imprevista tiene horas fichadas.";

export function assertCanDeleteAdHocTask(task: {
  systemKind: TaskSystemKind | null;
  _count: { timeEntries: number };
}): void {
  if (task.systemKind !== TaskSystemKind.AD_HOC) {
    throw new Error(AD_HOC_DELETE_NOT_AD_HOC_ERROR);
  }
  if (task._count.timeEntries > 0) {
    throw new Error(AD_HOC_DELETE_HAS_TIME_ENTRIES_ERROR);
  }
}

export async function deleteAdHocTaskRecord(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<void> {
  await tx.task.delete({ where: { id: taskId } });
}
