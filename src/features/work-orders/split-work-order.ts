import type { Prisma } from "@/generated/prisma";
import { allocateWorkOrderNumber } from "./number";
import { assignTasksToWorkOrder } from "./validate-tasks";

export interface SplitWorkOrderInput {
  workOrderId: string;
  taskIds: string[];
  notes?: string | null;
}

export interface SplitWorkOrderResult {
  id: string;
  number: string;
}

function uniqueTaskIds(taskIds: string[]): string[] {
  return [...new Set(taskIds)];
}

export async function splitWorkOrderInTx(
  tx: Prisma.TransactionClient,
  input: SplitWorkOrderInput,
): Promise<SplitWorkOrderResult> {
  const selectedTaskIds = uniqueTaskIds(input.taskIds);
  if (selectedTaskIds.length !== input.taskIds.length) {
    throw new Error("Hay tareas duplicadas en la selección.");
  }

  const source = await tx.workOrder.findUnique({
    where: { id: input.workOrderId },
    select: {
      id: true,
      number: true,
      status: true,
      tasks: { select: { id: true } },
    },
  });

  if (!source) throw new Error("OT no encontrada.");
  if (source.status !== "OPEN") throw new Error("Solo se pueden dividir OT abiertas.");
  if (source.tasks.length < 2) {
    throw new Error("La OT debe tener al menos 2 tareas para poder dividirse.");
  }

  const sourceTaskIds = source.tasks.map((task) => task.id);
  const sourceTaskSet = new Set(sourceTaskIds);
  for (const taskId of selectedTaskIds) {
    if (!sourceTaskSet.has(taskId)) {
      throw new Error("Alguna tarea seleccionada no pertenece a la OT de origen.");
    }
  }

  if (selectedTaskIds.length === 0) {
    throw new Error("Debes seleccionar al menos una tarea para dividir.");
  }
  if (selectedTaskIds.length >= sourceTaskIds.length) {
    throw new Error("La OT de origen debe conservar al menos una tarea.");
  }

  const { year, serial, number } = await allocateWorkOrderNumber(tx);
  const created = await tx.workOrder.create({
    data: {
      number,
      year,
      serial,
      notes: input.notes ?? null,
    },
    select: { id: true, number: true },
  });

  const selectedTaskSet = new Set(selectedTaskIds);
  const remainingTaskIds = sourceTaskIds.filter((id) => !selectedTaskSet.has(id));

  await assignTasksToWorkOrder(tx, source.id, remainingTaskIds);
  await assignTasksToWorkOrder(tx, created.id, selectedTaskIds);

  return created;
}
