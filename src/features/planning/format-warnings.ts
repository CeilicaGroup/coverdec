import { prisma } from "@/lib/db";

export interface RawPlanningWarning {
  taskId: string;
  reason: string;
}

export function formatTaskPlanningLabel(task: {
  process: string;
  project: { name: string };
  lamp: { name: string };
}): string {
  return `${task.project.name} · ${task.lamp.name} · ${task.process}`;
}

/** Sustituye IDs de tarea por «proyecto · lámpara · proceso» en los avisos. */
export async function formatPlanningWarningMessages(
  warnings: RawPlanningWarning[],
): Promise<string[]> {
  if (warnings.length === 0) return [];

  const taskIds = [...new Set(warnings.map((w) => w.taskId))];
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      process: true,
      project: { select: { name: true } },
      lamp: { select: { name: true } },
    },
  });
  const labelById = new Map(
    tasks.map((t) => [t.id, formatTaskPlanningLabel(t)]),
  );

  return warnings.map((w) => {
    const label = labelById.get(w.taskId) ?? w.taskId;
    return `${label}: ${w.reason}`;
  });
}
