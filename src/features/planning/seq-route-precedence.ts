import { ElementRouteType } from "@/generated/prisma";

interface SeqPrecedenceTask {
  id: string;
  lampId: string;
  naveId: string;
  minWeekQuarter?: number;
}

interface LampRouteInfo {
  routeType: ElementRouteType;
}

/**
 * Tras precedencia intra-elemento, refuerza que tareas N2 no empiecen antes que N3
 * en lámparas con ruta SEQ (planning coordinado Fase D).
 */
export function applySeqRoutePrecedence(args: {
  tasks: SeqPrecedenceTask[];
  minByTask: Map<string, number>;
  lampRouteByLampId: Map<string, LampRouteInfo>;
  naveCodigoById: Map<string, string>;
}): Map<string, number> {
  const result = new Map(args.minByTask);

  const tasksByLamp = new Map<string, SeqPrecedenceTask[]>();
  for (const task of args.tasks) {
    const list = tasksByLamp.get(task.lampId) ?? [];
    list.push(task);
    tasksByLamp.set(task.lampId, list);
  }

  for (const [lampId, lampTasks] of tasksByLamp) {
    const route = args.lampRouteByLampId.get(lampId);
    if (route?.routeType !== ElementRouteType.SEQ_N3_N2) continue;

    const n3Tasks = lampTasks.filter(
      (t) => args.naveCodigoById.get(t.naveId) === "N3",
    );
    const n2Tasks = lampTasks.filter(
      (t) => args.naveCodigoById.get(t.naveId) === "N2",
    );
    if (n3Tasks.length === 0 || n2Tasks.length === 0) continue;

    const maxN3 = Math.max(
      ...n3Tasks.map((t) => result.get(t.id) ?? t.minWeekQuarter ?? 0),
    );

    for (const n2 of n2Tasks) {
      const current = result.get(n2.id) ?? n2.minWeekQuarter ?? 0;
      if (current < maxN3) result.set(n2.id, maxN3);
    }
  }

  return result;
}
