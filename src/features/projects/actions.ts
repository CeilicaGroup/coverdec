"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { ElementTypology, ProjectPlanningPreset, Role } from "@/generated/prisma";
import {
  projectPlanningStrategySchema,
  PROJECT_PLANNING_PRESETS,
} from "@/features/planning/policy-schema";
import {
  buildTasksFromElement,
  formatLampElementUnitLabel,
  getNextTaskOrder,
} from "@/features/projects/lamp-tasks";
import {
  syncLampElements,
  type LampElementConfig,
} from "@/features/projects/sync-lamp-elements";

const log = childLogger({ module: "projects.actions" });

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase()
    .slice(0, 80);
}

async function getDefaultTaskNaveId(): Promise<string> {
  const nave = await prisma.nave.findFirst({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true },
  });
  if (!nave) throw new Error("No hay ninguna nave activa.");
  return nave.id;
}

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  client: z.string().optional(),
  obra: z.string().optional(),
  deliveryDate: z.string().optional(),
  isBillable: z.boolean().default(true),
  responsibleUserId: z.string().min(1).optional(),
  notes: z.string().optional(),
  planningPreset: z.nativeEnum(ProjectPlanningPreset).optional(),
  planningCostPriority: z.number().min(0).max(100).optional(),
  planningStability: z.number().min(0).max(100).optional(),
  planningDeadlineBoost: z.number().min(0).max(100).optional(),
});

export async function createProject(input: z.infer<typeof projectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = projectSchema.parse(input);
  const baseCode = slug(data.name) || `proj-${Date.now()}`;
  let code = baseCode;
  let suffix = 1;
  while (await prisma.project.findUnique({ where: { code } })) {
    suffix += 1;
    code = `${baseCode}-${suffix}`;
  }
  const preset = data.planningPreset ?? ProjectPlanningPreset.EQUILIBRADO;
  const presetDefaults = PROJECT_PLANNING_PRESETS[preset];
  const project = await prisma.project.create({
    data: {
      code,
      name: data.name,
      client: data.client,
      obra: data.obra,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
      isBillable: data.isBillable,
      responsibleUserId: data.responsibleUserId || null,
      notes: data.notes,
      planningPreset: preset,
      planningCostPriority: data.planningCostPriority ?? presetDefaults.costPriority,
      planningStability: data.planningStability ?? presetDefaults.stability,
      planningDeadlineBoost:
        data.planningDeadlineBoost ?? presetDefaults.deadlineBoost,
    },
  });
  log.info({ id: project.id }, "project created");
  revalidatePath("/dashboard/proyectos");
  return { id: project.id };
}

const updateProjectSchema = projectSchema.extend({
  projectId: z.string().min(1),
});

export async function updateProject(input: z.infer<typeof updateProjectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateProjectSchema.parse(input);

  await prisma.project.update({
    where: { id: data.projectId },
    data: {
      name: data.name,
      client: data.client || null,
      obra: data.obra || null,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      isBillable: data.isBillable,
      responsibleUserId: data.responsibleUserId || null,
      notes: data.notes?.trim() ? data.notes.trim() : null,
      planningPreset: data.planningPreset ?? undefined,
      planningCostPriority: data.planningCostPriority ?? undefined,
      planningStability: data.planningStability ?? undefined,
      planningDeadlineBoost: data.planningDeadlineBoost ?? undefined,
    },
  });

  log.info({ id: data.projectId }, "project updated");
  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${data.projectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/proyecto");
  return { id: data.projectId };
}

const lampElementInputSchema = z.object({
  typology: z.nativeEnum(ElementTypology),
  elementTypeId: z.string().min(1),
  surfaceM2: z.number().positive(),
  units: z.number().int().positive(),
});

const lampSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  elements: z.array(lampElementInputSchema).min(1),
});

function assertUniqueElementTypes(elements: { elementTypeId: string }[]) {
  const ids = elements.map((e) => e.elementTypeId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("No puedes repetir el mismo tipo de elemento en una lámpara.");
  }
}

export async function createLamp(input: z.infer<typeof lampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = lampSchema.parse(input);
  assertUniqueElementTypes(data.elements);
  const taskNaveId = await getDefaultTaskNaveId();

  const elementTypeIds = [...new Set(data.elements.map((e) => e.elementTypeId))];
  const elementTypes = await prisma.elementType.findMany({
    where: { id: { in: elementTypeIds } },
    select: { id: true, name: true, typology: true },
  });
  const elementNameById = new Map(elementTypes.map((e) => [e.id, e.name]));
  const typologyById = new Map(elementTypes.map((e) => [e.id, e.typology]));
  if (elementTypes.length !== elementTypeIds.length) {
    throw new Error("Alguno de los elementos seleccionados no existe.");
  }

  for (const row of data.elements) {
    if (typologyById.get(row.elementTypeId) !== row.typology) {
      throw new Error("La tipología no coincide con el tipo de elemento elegido.");
    }
  }

  const elementBlueprints = await Promise.all(
    data.elements.map(async (element) => ({
      element,
      blueprints: await buildTasksFromElement(element.elementTypeId, element.surfaceM2),
    })),
  );
  if (!elementBlueprints.some(({ blueprints }) => blueprints.length > 0)) {
    throw new Error(
      "Ningún elemento tiene procesos con horas para las medidas indicadas.",
    );
  }

  const primary = data.elements[0]!;
  const totalUnits = data.elements.reduce((sum, e) => sum + e.units, 0);

  const lamp = await prisma.$transaction(async (tx) => {
    const created = await tx.lamp.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        elementTypeId: primary.elementTypeId,
        surfaceM2: primary.surfaceM2,
        units: totalUnits,
      },
    });

    const tasksToCreate: Array<{
      projectId: string;
      lampId: string;
      lampElementId: string;
      process: string;
      estimatedHours: number;
      order: number;
      naveId: string;
    }> = [];

    let physicalElementIndex = 0;

    for (const { element, blueprints } of elementBlueprints) {
      if (blueprints.length === 0) continue;

      const elementName = elementNameById.get(element.elementTypeId) ?? "Elemento";

      for (let unitIndex = 1; unitIndex <= element.units; unitIndex++) {
        const lampElement = await tx.lampElement.create({
          data: {
            lampId: created.id,
            elementTypeId: element.elementTypeId,
            label: formatLampElementUnitLabel(elementName, unitIndex, element.units),
            surfaceM2: element.surfaceM2,
            units: 1,
          },
        });

        for (const bp of blueprints) {
          tasksToCreate.push({
            projectId: data.projectId,
            lampId: created.id,
            lampElementId: lampElement.id,
            process: bp.process,
            estimatedHours: bp.estimatedHours,
            order: bp.order + physicalElementIndex * 1000,
            naveId: taskNaveId,
          });
        }

        physicalElementIndex += 1;
      }
    }

    if (tasksToCreate.length > 0) {
      await tx.task.createMany({ data: tasksToCreate });
    }

    return created;
  });

  log.info({ lampId: lamp.id }, "lamp created with tasks");
  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${data.projectId}`);
  return { id: lamp.id };
}

const renameLampSchema = z.object({
  lampId: z.string().min(1),
  name: z.string().min(1).max(120),
});

const updateLampElementsSchema = z.object({
  lampId: z.string().min(1),
  elements: z.array(lampElementInputSchema).min(1),
});

export async function updateLampElements(
  input: z.infer<typeof updateLampElementsSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateLampElementsSchema.parse(input);
  assertUniqueElementTypes(data.elements);
  const taskNaveId = await getDefaultTaskNaveId();

  const lamp = await prisma.lamp.findFirst({
    where: { id: data.lampId },
    select: { id: true, projectId: true },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  await prisma.$transaction(async (tx) => {
    await syncLampElements(tx, {
      lampId: lamp.id,
      projectId: lamp.projectId,
      elements: data.elements as LampElementConfig[],
      taskNaveId,
    });
  });

  log.info({ lampId: lamp.id }, "lamp elements updated");
  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${lamp.projectId}`);
  return { id: lamp.id };
}

/** @deprecated Use updateLampElements */
export async function updateLampFrames(input: {
  lampId: string;
  frames: Array<{
    elementTypeId: string;
    surfaceM2: number;
    units: number;
    typology?: ElementTypology;
  }>;
}) {
  const elementTypes = await prisma.elementType.findMany({
    where: { id: { in: input.frames.map((f) => f.elementTypeId) } },
    select: { id: true, typology: true },
  });
  const byId = new Map(elementTypes.map((e) => [e.id, e]));
  const elements = input.frames.map((f) => {
    const et = byId.get(f.elementTypeId);
    if (!et) throw new Error("Elemento no encontrado");
    return {
      typology: f.typology ?? et.typology,
      elementTypeId: f.elementTypeId,
      surfaceM2: f.surfaceM2,
      units: f.units,
    };
  });
  return updateLampElements({ lampId: input.lampId, elements });
}

export async function renameLamp(input: z.infer<typeof renameLampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { lampId, name } = renameLampSchema.parse(input);
  await prisma.lamp.update({ where: { id: lampId }, data: { name: name.trim() } });
  revalidatePath("/dashboard/proyectos");
}

const updateTaskHoursSchema = z.object({
  taskId: z.string().min(1),
  estimatedHours: z.number().positive(),
});

export async function updateTaskHours(input: z.infer<typeof updateTaskHoursSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateTaskHoursSchema.parse(input);

  const task = await prisma.task.findFirst({ where: { id: data.taskId } });
  if (!task) throw new Error("Tarea no encontrada");

  await prisma.task.update({
    where: { id: task.id },
    data: { estimatedHours: data.estimatedHours },
  });

  revalidatePath("/dashboard/proyectos");
}

const addExtraTaskSchema = z.object({
  lampId: z.string().min(1),
  process: z.string().min(1),
  estimatedHours: z.number().positive(),
});

export async function addExtraTask(input: z.infer<typeof addExtraTaskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = addExtraTaskSchema.parse(input);

  const lamp = await prisma.lamp.findFirst({
    where: { id: data.lampId },
    select: { id: true, projectId: true, elementTypeId: true },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  const primaryLampElement = await prisma.lampElement.findFirst({
    where: { lampId: lamp.id, elementTypeId: lamp.elementTypeId },
    select: { id: true },
  });

  if (primaryLampElement) {
    const exists = await prisma.task.count({
      where: {
        lampId: lamp.id,
        lampElementId: primaryLampElement.id,
        process: data.process,
      },
    });
    if (exists > 0) {
      throw new Error("Ese proceso ya existe en este elemento.");
    }
  } else {
    const exists = await prisma.task.count({
      where: { lampId: lamp.id, process: data.process, lampElementId: null },
    });
    if (exists > 0) throw new Error("Ese proceso ya existe en esta lámpara.");
  }

  const naveId =
    (
      await prisma.task.findFirst({
        where: { lampId: lamp.id },
        select: { naveId: true },
      })
    )?.naveId ?? (await getDefaultTaskNaveId());

  await prisma.$transaction(async (tx) => {
    const order = await getNextTaskOrder(tx, lamp.id);
    await tx.task.create({
      data: {
        projectId: lamp.projectId,
        lampId: lamp.id,
        lampElementId: primaryLampElement?.id,
        process: data.process,
        estimatedHours: data.estimatedHours,
        order,
        naveId,
      },
    });
  });

  revalidatePath("/dashboard/proyectos");
}

const deleteTaskSchema = z.object({ taskId: z.string().min(1) });

export async function deleteTask(input: z.infer<typeof deleteTaskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteTaskSchema.parse(input);

  const task = await prisma.task.findFirst({
    where: { id: data.taskId },
    include: { _count: { select: { assignments: true, timeEntries: true } } },
  });
  if (!task) throw new Error("Tarea no encontrada");

  if (task._count.timeEntries > 0) {
    throw new Error("No se puede eliminar: la tarea tiene horas registradas.");
  }
  if (task._count.assignments > 0 || task._count.timeEntries > 0) {
    throw new Error(
      "No se puede eliminar: hay asignaciones de planning o partes de trabajo.",
    );
  }

  await prisma.task.delete({ where: { id: task.id } });
  revalidatePath("/dashboard/proyectos");
}

const updateTaskNotesSchema = z.object({
  taskId: z.string().min(1),
  notes: z.string().max(500).nullable(),
});

export async function updateTaskNotes(input: z.infer<typeof updateTaskNotesSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateTaskNotesSchema.parse(input);

  const task = await prisma.task.findFirst({ where: { id: data.taskId } });
  if (!task) throw new Error("Tarea no encontrada");

  await prisma.task.update({
    where: { id: task.id },
    data: { notes: data.notes?.trim() ? data.notes.trim() : null },
  });

  revalidatePath("/dashboard/proyectos");
}

const reorderTaskSchema = z.object({
  taskId: z.string().min(1),
  direction: z.enum(["up", "down"]),
});

export async function reorderTask(input: z.infer<typeof reorderTaskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = reorderTaskSchema.parse(input);

  await prisma.$transaction(async (tx) => {
    const task = await tx.task.findUnique({
      where: { id: data.taskId },
      select: { id: true, lampId: true, order: true },
    });
    if (!task) throw new Error("Tarea no encontrada");

    const sibling = await tx.task.findFirst({
      where: {
        lampId: task.lampId,
        order:
          data.direction === "up"
            ? { lt: task.order }
            : { gt: task.order },
      },
      orderBy: { order: data.direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!sibling) return;

    await tx.task.update({
      where: { id: task.id },
      data: { order: sibling.order },
    });
    await tx.task.update({
      where: { id: sibling.id },
      data: { order: task.order },
    });
  });

  revalidatePath("/dashboard/proyectos");
}

const deleteLampSchema = z.object({ lampId: z.string().min(1) });

export async function deleteLamp(input: z.infer<typeof deleteLampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteLampSchema.parse(input);

  const lamp = await prisma.lamp.findFirst({
    where: { id: data.lampId },
    include: {
      tasks: {
        include: {
          _count: { select: { assignments: true, timeEntries: true } },
        },
      },
    },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  const hasWork = lamp.tasks.some(
    (t) =>
      t._count.assignments > 0 ||
      t._count.timeEntries > 0,
  );
  if (hasWork) {
    throw new Error(
      "No se puede eliminar: hay horas o referencias en las tareas de esta lámpara.",
    );
  }

  await prisma.lamp.delete({ where: { id: lamp.id } });
  revalidatePath("/dashboard/proyectos");
}

const toggleSchema = z.object({ projectId: z.string().min(1), isActive: z.boolean() });

export async function toggleProjectActive(input: z.infer<typeof toggleSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = toggleSchema.parse(input);
  await prisma.project.update({
    where: { id: data.projectId },
    data: { isActive: data.isActive },
  });
  revalidatePath("/dashboard/proyectos");
}

const deleteProjectSchema = z.object({ projectId: z.string().min(1) });

export async function deleteProject(input: z.infer<typeof deleteProjectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { projectId } = deleteProjectSchema.parse(input);

  const [timeEntries, orders] = await Promise.all([
    prisma.timeEntry.count({ where: { projectId } }),
    prisma.productionOrder.count({ where: { projectId } }),
  ]);

  if (timeEntries > 0 || orders > 0) {
    throw new Error(
      "ARCHIVE_ONLY: Hay partes de trabajo u órdenes de producción vinculadas. Solo se puede archivar el proyecto (desactivar).",
    );
  }

  await prisma.project.delete({ where: { id: projectId } });
  log.info({ projectId }, "project deleted");
  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
}

const updateProjectStrategySchema = z.object({
  projectId: z.string().min(1),
  strategy: projectPlanningStrategySchema,
});

export async function updateProjectPlanningStrategy(
  input: z.infer<typeof updateProjectStrategySchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateProjectStrategySchema.parse(input);

  await prisma.project.update({
    where: { id: data.projectId },
    data: {
      planningPreset: data.strategy.preset,
      planningCostPriority: data.strategy.costPriority,
      planningStability: data.strategy.stability,
      planningDeadlineBoost: data.strategy.deadlineBoost,
    },
  });

  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${data.projectId}`);
  revalidatePath("/dashboard");
}

const applyProjectPresetSchema = z.object({
  projectId: z.string().min(1),
  preset: z.nativeEnum(ProjectPlanningPreset),
});

export async function applyProjectPlanningPreset(
  input: z.infer<typeof applyProjectPresetSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = applyProjectPresetSchema.parse(input);
  const strategy = PROJECT_PLANNING_PRESETS[data.preset];

  await prisma.project.update({
    where: { id: data.projectId },
    data: {
      planningPreset: data.preset,
      planningCostPriority: strategy.costPriority,
      planningStability: strategy.stability,
      planningDeadlineBoost: strategy.deadlineBoost,
    },
  });

  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${data.projectId}`);
  revalidatePath("/dashboard");
}

const applyGlobalPresetSchema = z.object({
  preset: z.nativeEnum(ProjectPlanningPreset),
});

export async function applyGlobalPlanningPresetToActiveProjects(
  input: z.infer<typeof applyGlobalPresetSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = applyGlobalPresetSchema.parse(input);
  const strategy = PROJECT_PLANNING_PRESETS[data.preset];

  const result = await prisma.project.updateMany({
    where: { isActive: true },
    data: {
      planningPreset: data.preset,
      planningCostPriority: strategy.costPriority,
      planningStability: strategy.stability,
      planningDeadlineBoost: strategy.deadlineBoost,
    },
  });

  log.info(
    { updatedCount: result.count, preset: data.preset },
    "global planning preset applied",
  );

  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard");
  return { updatedCount: result.count };
}
