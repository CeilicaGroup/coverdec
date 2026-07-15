import type { Prisma } from "@/generated/prisma";
import { TaskSystemKind } from "@/generated/prisma";

/** Tareas productivas: systemKind null (legacy) o cualquier valor distinto de AD_HOC. */
export function productiveTaskSystemKindWhere(): Prisma.TaskWhereInput {
  return {
    OR: [
      { systemKind: null },
      { systemKind: { not: TaskSystemKind.AD_HOC } },
    ],
  };
}
