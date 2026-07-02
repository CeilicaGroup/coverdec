import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { TRANSPORT_PROCESS_CODE } from "@/features/projects/transport-tasks";

export function isWorkOrderExemptTask(task: {
  process?: string;
  systemKind?: TaskSystemKind | null;
}): boolean {
  if (task.systemKind === TaskSystemKind.AD_HOC) return true;
  if (task.systemKind === TaskSystemKind.TRANSPORT) return true;
  if (task.process === IMPREVISTA_PROCESS_CODE) return true;
  if (task.process === TRANSPORT_PROCESS_CODE) return true;
  return false;
}

/** Tareas que no deben exigir ni aparecer en OT (imprevistas y transporte). */
export function workOrderExemptTaskWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { systemKind: TaskSystemKind.AD_HOC },
      { systemKind: TaskSystemKind.TRANSPORT },
      { process: IMPREVISTA_PROCESS_CODE },
      { process: TRANSPORT_PROCESS_CODE },
    ],
  };
}

/**
 * Tareas productivas elegibles para OT.
 * No usar `NOT workOrderExemptTaskWhere()`: en SQL, `NOT (NULL = enum)` excluye
 * filas con systemKind null, que es el caso de las tareas de catálogo recién creadas.
 */
export function excludeWorkOrderExemptTasksWhere(): Prisma.TaskWhereInput {
  return {
    process: { notIn: [IMPREVISTA_PROCESS_CODE, TRANSPORT_PROCESS_CODE] },
    OR: [
      { systemKind: null },
      {
        systemKind: {
          notIn: [TaskSystemKind.AD_HOC, TaskSystemKind.TRANSPORT],
        },
      },
    ],
  };
}
