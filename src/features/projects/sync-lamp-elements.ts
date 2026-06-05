import type { ElementTypology, Prisma } from "@/generated/prisma";
import {
  adjustPendingOnEstimateChange,
  buildTasksFromElement,
  formatLampElementUnitLabel,
  type TaskBlueprint,
} from "@/features/projects/lamp-tasks";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { resolveNaveForElementType } from "@/features/projects/task-nave";

export interface LampElementConfig {
  typology: ElementTypology;
  elementTypeId: string;
  surfaceM2: number;
  units: number;
}

interface LampElementRow {
  id: string;
  elementTypeId: string;
  label: string | null;
  surfaceM2: number | null;
  tasks: Array<{
    id: string;
    process: string;
    estimatedHours: number;
    order: number;
    _count: { assignments: number; timeEntries: number };
  }>;
}

function elementHasWork(element: LampElementRow): boolean {
  return element.tasks.some(
    (t) => t._count.assignments > 0 || t._count.timeEntries > 0,
  );
}

function taskHasWork(task: LampElementRow["tasks"][number]): boolean {
  return task._count.assignments > 0 || task._count.timeEntries > 0;
}

/** Agrupa unidades físicas (LampElement) en configuración editable por tipo de elemento. */
export function lampElementsToConfig(
  elements: Array<{
    elementTypeId: string;
    surfaceM2: number | null;
    elementType: { typology: ElementTypology };
  }>,
): LampElementConfig[] {
  const groups = new Map<string, LampElementConfig>();
  for (const el of elements) {
    const existing = groups.get(el.elementTypeId);
    if (existing) {
      existing.units += 1;
    } else {
      groups.set(el.elementTypeId, {
        typology: el.elementType.typology,
        elementTypeId: el.elementTypeId,
        surfaceM2: el.surfaceM2 ?? 0,
        units: 1,
      });
    }
  }
  return [...groups.values()];
}

export function fallbackLampConfig(lamp: {
  elementTypeId: string;
  surfaceM2: number | null;
  units: number;
  elementType: { typology: ElementTypology };
}): LampElementConfig[] {
  return [
    {
      typology: lamp.elementType.typology,
      elementTypeId: lamp.elementTypeId,
      surfaceM2: lamp.surfaceM2 ?? 0,
      units: lamp.units,
    },
  ];
}

async function applyBlueprintHours(
  tx: Prisma.TransactionClient,
  taskId: string,
  newEstimate: number,
): Promise<void> {
  await tx.task.update({
    where: { id: taskId },
    data: { estimatedHours: newEstimate },
  });
}

async function recalcElementTasks(
  tx: Prisma.TransactionClient,
  element: LampElementRow,
  blueprints: TaskBlueprint[],
  doneByTaskId: Map<string, number>,
): Promise<void> {
  const blueprintByProcess = new Map(blueprints.map((bp) => [bp.process, bp]));

  for (const task of element.tasks) {
    const bp = blueprintByProcess.get(task.process);
    if (!bp) continue;

    const doneHours = doneByTaskId.get(task.id) ?? 0;
    if (taskHasWork(task) && doneHours > 0) {
      const nextEstimate = adjustPendingOnEstimateChange(
        bp.estimatedHours,
        doneHours,
        Math.max(0, task.estimatedHours - doneHours),
      );
      if (Math.abs(nextEstimate - task.estimatedHours) > 0.001) {
        await applyBlueprintHours(tx, task.id, nextEstimate);
      }
      continue;
    }

    if (taskHasWork(task)) {
      if (Math.abs(bp.estimatedHours - task.estimatedHours) > 0.001) {
        await applyBlueprintHours(tx, task.id, bp.estimatedHours);
      }
      continue;
    }

    await applyBlueprintHours(tx, task.id, bp.estimatedHours);
  }
}

async function createElementWithTasks(
  tx: Prisma.TransactionClient,
  params: {
    lampId: string;
    projectId: string;
    elementTypeDefaultNaves: Map<string, string>;
    fallbackNaveId: string;
    elementTypeId: string;
    elementName: string;
    surfaceM2: number;
    unitIndex: number;
    totalUnits: number;
    blueprints: TaskBlueprint[];
    physicalElementIndex: number;
  },
): Promise<void> {
  const {
    lampId,
    projectId,
    elementTypeDefaultNaves,
    fallbackNaveId,
    elementTypeId,
    elementName,
    surfaceM2,
    unitIndex,
    totalUnits,
    blueprints,
    physicalElementIndex,
  } = params;

  const lampElement = await tx.lampElement.create({
    data: {
      lampId,
      elementTypeId,
      label: formatLampElementUnitLabel(elementName, unitIndex, totalUnits),
      surfaceM2,
      units: 1,
    },
  });

  if (blueprints.length === 0) return;

  await tx.task.createMany({
    data: blueprints.map((bp) => ({
      projectId,
      lampId,
      lampElementId: lampElement.id,
      process: bp.process,
      estimatedHours: bp.estimatedHours,
      order: bp.order + physicalElementIndex * 1000,
      naveId: resolveNaveForElementType(
        elementTypeId,
        elementTypeDefaultNaves,
        fallbackNaveId,
      ),
    })),
  });
}

async function removeElementIfAllowed(
  tx: Prisma.TransactionClient,
  element: LampElementRow,
): Promise<void> {
  if (elementHasWork(element)) {
    throw new Error(
      `No se puede quitar «${element.label ?? "unidad"}»: tiene horas o planificación registradas.`,
    );
  }
  await tx.task.deleteMany({ where: { lampElementId: element.id } });
  await tx.lampElement.delete({ where: { id: element.id } });
}

async function relabelElements(
  tx: Prisma.TransactionClient,
  elements: LampElementRow[],
  elementName: string,
  totalUnits: number,
): Promise<void> {
  const sorted = [...elements].sort((a, b) =>
    (a.label ?? "").localeCompare(b.label ?? "", undefined, { numeric: true }),
  );
  for (let i = 0; i < sorted.length; i++) {
    const label = formatLampElementUnitLabel(elementName, i + 1, totalUnits);
    if (sorted[i]!.label !== label) {
      await tx.lampElement.update({
        where: { id: sorted[i]!.id },
        data: { label },
      });
    }
  }
}

export async function syncLampElements(
  tx: Prisma.TransactionClient,
  params: {
    lampId: string;
    projectId: string;
    elements: LampElementConfig[];
    elementTypeDefaultNaves: Map<string, string>;
    fallbackNaveId: string;
  },
): Promise<void> {
  const { lampId, projectId, elements, elementTypeDefaultNaves, fallbackNaveId } =
    params;

  if (elements.length === 0) {
    throw new Error("La lámpara debe tener al menos un elemento.");
  }

  const lamp = await tx.lamp.findFirst({
    where: { id: lampId },
    include: {
      elements: {
        orderBy: { createdAt: "asc" },
        include: {
          tasks: {
            include: {
              _count: { select: { assignments: true, timeEntries: true } },
            },
          },
        },
      },
    },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  const elementTypeIds = [...new Set(elements.map((e) => e.elementTypeId))];
  const elementTypes = await tx.elementType.findMany({
    where: { id: { in: elementTypeIds } },
    select: { id: true, name: true, typology: true },
  });
  const elementNameById = new Map(elementTypes.map((e) => [e.id, e.name]));
  const typologyById = new Map(elementTypes.map((e) => [e.id, e.typology]));
  if (elementTypes.length !== elementTypeIds.length) {
    throw new Error("Alguno de los elementos seleccionados no existe.");
  }

  for (const config of elements) {
    const expected = typologyById.get(config.elementTypeId);
    if (expected !== config.typology) {
      throw new Error("La tipología no coincide con el tipo de elemento elegido.");
    }
  }

  const existingByType = new Map<string, LampElementRow[]>();
  for (const element of lamp.elements) {
    const list = existingByType.get(element.elementTypeId) ?? [];
    list.push(element);
    existingByType.set(element.elementTypeId, list);
  }

  const desiredTypeIds = new Set(elementTypeIds);

  for (const [elementTypeId, existingElements] of existingByType) {
    if (!desiredTypeIds.has(elementTypeId)) {
      for (const element of [...existingElements].reverse()) {
        await removeElementIfAllowed(tx, element);
      }
    }
  }

  for (const config of elements) {
    const elementName = elementNameById.get(config.elementTypeId) ?? "Elemento";
    const blueprints = await buildTasksFromElement(
      config.elementTypeId,
      config.surfaceM2,
    );
    if (blueprints.length === 0) {
      throw new Error(
        `«${elementName}» no genera tareas con ${config.surfaceM2} m².`,
      );
    }

    let existingElements = existingByType.get(config.elementTypeId) ?? [];
    const currentCount = existingElements.length;

    if (currentCount === 0) {
      for (let unitIndex = 1; unitIndex <= config.units; unitIndex++) {
        const physicalElementIndex = await tx.lampElement.count({ where: { lampId } });
        await createElementWithTasks(tx, {
          lampId,
          projectId,
          elementTypeDefaultNaves,
          fallbackNaveId,
          elementTypeId: config.elementTypeId,
          elementName,
          surfaceM2: config.surfaceM2,
          unitIndex,
          totalUnits: config.units,
          blueprints,
          physicalElementIndex,
        });
      }
      continue;
    }

    const taskIds = existingElements.flatMap((e) => e.tasks.map((t) => t.id));
    const doneByTaskId = await loadDoneHoursByTaskIds(tx, taskIds);

    for (const element of existingElements) {
      if (element.surfaceM2 !== config.surfaceM2) {
        await tx.lampElement.update({
          where: { id: element.id },
          data: { surfaceM2: config.surfaceM2 },
        });
        await recalcElementTasks(tx, element, blueprints, doneByTaskId);
      }
    }

    if (config.units > currentCount) {
      for (let unitIndex = currentCount + 1; unitIndex <= config.units; unitIndex++) {
        const physicalElementIndex = await tx.lampElement.count({ where: { lampId } });
        await createElementWithTasks(tx, {
          lampId,
          projectId,
          elementTypeDefaultNaves,
          fallbackNaveId,
          elementTypeId: config.elementTypeId,
          elementName,
          surfaceM2: config.surfaceM2,
          unitIndex,
          totalUnits: config.units,
          blueprints,
          physicalElementIndex,
        });
      }
      existingElements = (await tx.lampElement.findMany({
        where: { lampId, elementTypeId: config.elementTypeId },
        orderBy: { createdAt: "asc" },
        include: {
          tasks: {
            include: {
              _count: { select: { assignments: true, timeEntries: true } },
            },
          },
        },
      })) as LampElementRow[];
    } else if (config.units < currentCount) {
      const sorted = [...existingElements].sort((a, b) =>
        (b.label ?? "").localeCompare(a.label ?? "", undefined, { numeric: true }),
      );
      const toRemove = sorted.slice(0, currentCount - config.units);
      for (const element of toRemove) {
        await removeElementIfAllowed(tx, element);
      }
      existingElements = existingElements.filter(
        (e) => !toRemove.some((r) => r.id === e.id),
      );
    }

    if (config.units > 1) {
      await relabelElements(tx, existingElements, elementName, config.units);
    } else if (existingElements.length === 1) {
      await tx.lampElement.update({
        where: { id: existingElements[0]!.id },
        data: { label: elementName },
      });
    }
  }

  const primary = elements[0]!;
  const totalUnits = elements.reduce((sum, e) => sum + e.units, 0);

  await tx.lamp.update({
    where: { id: lampId },
    data: {
      elementTypeId: primary.elementTypeId,
      surfaceM2: primary.surfaceM2,
      units: totalUnits,
    },
  });
}
