import { prisma } from "@/lib/db";
import { stripNoCandidatePrefix } from "@/features/planning/engine/solver-types";

export interface RawPlanningWarning {
  taskId: string;
  reason: string;
}

export function formatTaskPlanningLabel(task: {
  process: string;
  processLabel?: string | null;
  project: { name: string };
  lamp: { name: string };
}): string {
  const processLabel = task.processLabel?.trim() || task.process;
  return `${task.project.name} · ${task.lamp.name} · ${processLabel}`;
}

/** Reemplaza códigos de proceso entre «…» por su label de catálogo. */
export function replaceProcessCodesInReason(
  reason: string,
  labelByCode: Map<string, string>,
): string {
  return reason.replace(/«([^»]+)»/g, (match, code: string) => {
    const label = labelByCode.get(code);
    return label ? `«${label}»` : match;
  });
}

/** Sustituye IDs de tarea por «proyecto · lámpara · proceso» en los avisos. */
export async function formatPlanningWarningMessages(
  warnings: RawPlanningWarning[],
): Promise<string[]> {
  if (warnings.length === 0) return [];

  const taskIds = [...new Set(warnings.map((w) => w.taskId))];
  const [tasks, processDefs] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: {
        id: true,
        process: true,
        processDefinition: { select: { label: true } },
        project: { select: { name: true } },
        lamp: { select: { name: true } },
      },
    }),
    prisma.processDefinition.findMany({
      select: { code: true, label: true },
    }),
  ]);
  const labelById = new Map(
    tasks.map((t) => [
      t.id,
      formatTaskPlanningLabel({
        process: t.process,
        processLabel: t.processDefinition?.label,
        project: t.project,
        lamp: t.lamp,
      }),
    ]),
  );
  const processLabelByCode = new Map(processDefs.map((p) => [p.code, p.label]));

  return warnings.map((w) => {
    const label = labelById.get(w.taskId) ?? w.taskId;
    const detail = replaceProcessCodesInReason(
      stripNoCandidatePrefix(w.reason),
      processLabelByCode,
    );
    return `${label}: ${detail}`;
  });
}
