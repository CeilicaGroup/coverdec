"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import {
  ElementTypology,
  ProjectKind,
  ProjectPlanningPreset,
  Role,
} from "@/generated/prisma";
import {
  createLampInputSchema,
  lampElementInputSchema,
  resolveCreateLampMode,
} from "@/features/projects/create-lamp-input";
import { MANUAL_ESTIMATION_PROCESS } from "@/lib/manual-lamp";
import {
  assertLampNameAllowed,
  isPrismaUniqueViolation,
  lampNameFields,
} from "@/features/projects/lamp-name-validation";
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
import {
  elementTaskScopeWhere,
  elementTypeIdFromGroupKey,
  loadTaskNaveContext,
  resolveNaveForElementType,
} from "@/features/projects/task-nave";

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

async function assertActiveNaveId(naveId: string) {
  const nave = await prisma.nave.findFirst({
    where: { id: naveId, isActive: true },
    select: { id: true },
  });
  if (!nave) throw new Error("La nave seleccionada no está activa.");
}

async function loadScopedTaskIds(args: {
  lampId: string;
  elementTypeId: string | null;
  process?: string;
}) {
  const tasks = await prisma.task.findMany({
    where: elementTaskScopeWhere(args),
    select: { id: true },
  });
  return tasks.map((task) => task.id);
}

async function persistTasksNave(taskIds: string[], naveId: string) {
  await assertActiveNaveId(naveId);
  if (taskIds.length === 0) return;

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      lamp: { select: { projectId: true } },
      _count: { select: { assignments: true } },
    },
  });

  if (tasks.some((task) => task._count.assignments > 0)) {
    throw new Error(
      "Alguna tarea tiene asignaciones de planning; no se puede cambiar la nave.",
    );
  }

  await prisma.task.updateMany({
    where: { id: { in: taskIds } },
    data: { naveId },
  });

  const projectIds = new Set(tasks.map((task) => task.lamp.projectId));
  revalidatePath("/dashboard/proyectos");
  for (const projectId of projectIds) {
    revalidatePath(`/dashboard/proyectos/${projectId}`);
  }
}

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  client: z.string().optional(),
  obra: z.string().optional(),
  deliveryDate: z.string().optional(),
  isBillable: z.boolean().default(true),
  kind: z.nativeEnum(ProjectKind).default(ProjectKind.PRODUCCION),
  responsibleUserId: z.string().min(1).optional(),
  notes: z.string().optional(),
  planningPreset: z.nativeEnum(ProjectPlanningPreset).optional(),
  planningCostPriority: z.number().min(0).max(100).optional(),
  planningStability: z.number().min(0).max(100).optional(),
  planningDeadlineBoost: z.number().min(0).max(100).optional(),
});

export async function createProject(input: z.infer<typeof projectSchema>) {
  return runAuditedMutation(
    "projects.createProject",
    async () => {
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
        kind: data.kind,
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
    },
    (result) => ({ summary: "Crear proyecto", entityType: "Project", entityId: result.id }),
  );
}

const updateProjectSchema = projectSchema.extend({
  projectId: z.string().min(1),
});

export async function updateProject(input: z.infer<typeof updateProjectSchema>) {
  return runAuditedMutation(
    "projects.updateProject",
    async () => {
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
        kind: data.kind,
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
    },
    (result) => ({ summary: "Actualizar proyecto", entityType: "Project", entityId: input.projectId }),
  );
}

async function persistLampName(
  args: {
    projectId: string;
    name: string;
    excludeLampId?: string;
    confirmSimilarName?: boolean;
  },
  persist: (fields: ReturnType<typeof lampNameFields>) => Promise<void>,
) {
  await assertLampNameAllowed(prisma, args);
  const fields = lampNameFields(args.name);
  if (!fields.nameKey) {
    throw new Error("El nombre de la lámpara no es válido.");
  }

  try {
    await persist(fields);
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      throw new Error(
        "Ya existe una lámpara con ese nombre en este proyecto.",
      );
    }
    throw error;
  }
}

function assertUniqueElementTypes(elements: { elementTypeId: string }[]) {
  const ids = elements.map((e) => e.elementTypeId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("No puedes repetir el mismo tipo de elemento en una lámpara.");
  }
}

export async function createLamp(input: z.infer<typeof createLampInputSchema>) {
  return runAuditedMutation(
    "projects.createLamp",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = createLampInputSchema.parse(input);
  
    const project = await prisma.project.findFirst({
      where: { id: data.projectId },
      select: { id: true, kind: true },
    });
    if (!project) throw new Error("Proyecto no encontrado");
  
    const mode = resolveCreateLampMode(project.kind, data);
    const { fallbackNaveId, elementTypeDefaultNaves } =
      await loadTaskNaveContext(prisma);
  
    if (mode === "manual") {
      let lampId = "";
      await persistLampName(
        {
          projectId: data.projectId,
          name: data.name,
          confirmSimilarName: data.confirmSimilarName,
        },
        async (fields) => {
          const lamp = await prisma.$transaction(async (tx) => {
            const created = await tx.lamp.create({
              data: {
                projectId: data.projectId,
                name: fields.name,
                nameKey: fields.nameKey,
              },
            });
  
            if (data.estimatedHours != null) {
              await tx.task.create({
                data: {
                  projectId: data.projectId,
                  lampId: created.id,
                  process: MANUAL_ESTIMATION_PROCESS,
                  estimatedHours: data.estimatedHours,
                  order: 0,
                  naveId: resolveNaveForElementType(
                    null,
                    elementTypeDefaultNaves,
                    fallbackNaveId,
                  ),
                },
              });
            }
  
            return created;
          });
          lampId = lamp.id;
        },
      );
  
      log.info({ lampId, mode: "manual" }, "lamp created");
      revalidatePath("/dashboard/proyectos");
      revalidatePath(`/dashboard/proyectos/${data.projectId}`);
      return { id: lampId };
    }
  
    const elements = data.elements!;
    assertUniqueElementTypes(elements);
  
    const elementTypeIds = [...new Set(elements.map((e) => e.elementTypeId))];
    const elementTypes = await prisma.elementType.findMany({
      where: { id: { in: elementTypeIds } },
      select: { id: true, name: true, typology: true },
    });
    const elementNameById = new Map(elementTypes.map((e) => [e.id, e.name]));
    const typologyById = new Map(elementTypes.map((e) => [e.id, e.typology]));
    if (elementTypes.length !== elementTypeIds.length) {
      throw new Error("Alguno de los elementos seleccionados no existe.");
    }
  
    for (const row of elements) {
      if (typologyById.get(row.elementTypeId) !== row.typology) {
        throw new Error("La tipología no coincide con el tipo de elemento elegido.");
      }
    }
  
    const elementBlueprints = await Promise.all(
      elements.map(async (element) => ({
        element,
        blueprints: await buildTasksFromElement(element.elementTypeId, element.surfaceM2),
      })),
    );
    if (!elementBlueprints.some(({ blueprints }) => blueprints.length > 0)) {
      throw new Error(
        "Ningún elemento tiene procesos con horas para las medidas indicadas.",
      );
    }
  
    const primary = elements[0]!;
    const totalUnits = elements.reduce((sum, e) => sum + e.units, 0);
  
    let catalogLampId = "";
    await persistLampName(
      {
        projectId: data.projectId,
        name: data.name,
        confirmSimilarName: data.confirmSimilarName,
      },
      async (fields) => {
        const lamp = await prisma.$transaction(async (tx) => {
          const created = await tx.lamp.create({
            data: {
              projectId: data.projectId,
              name: fields.name,
              nameKey: fields.nameKey,
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
  
            const elementName =
              elementNameById.get(element.elementTypeId) ?? "Elemento";
  
            for (let unitIndex = 1; unitIndex <= element.units; unitIndex++) {
              const lampElement = await tx.lampElement.create({
                data: {
                  lampId: created.id,
                  elementTypeId: element.elementTypeId,
                  label: formatLampElementUnitLabel(
                    elementName,
                    unitIndex,
                    element.units,
                  ),
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
                  naveId: resolveNaveForElementType(
                    element.elementTypeId,
                    elementTypeDefaultNaves,
                    fallbackNaveId,
                  ),
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
        catalogLampId = lamp.id;
      },
    );
  
    log.info({ lampId: catalogLampId }, "lamp created with tasks");
    revalidatePath("/dashboard/proyectos");
    revalidatePath(`/dashboard/proyectos/${data.projectId}`);
    return { id: catalogLampId };
    },
    (result) => ({ summary: "Crear lámpara", entityType: "Lamp", entityId: result.id }),
  );
}

const renameLampSchema = z.object({
  lampId: z.string().min(1),
  name: z.string().min(1).max(120),
  confirmSimilarName: z.boolean().optional(),
});

const updateLampElementsSchema = z.object({
  lampId: z.string().min(1),
  elements: z.array(lampElementInputSchema).min(1),
});

export async function updateLampElements(
  input: z.infer<typeof updateLampElementsSchema>,
) {
  return runAuditedMutation(
    "projects.updateLampElements",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = updateLampElementsSchema.parse(input);
    assertUniqueElementTypes(data.elements);
    const { fallbackNaveId, elementTypeDefaultNaves } =
      await loadTaskNaveContext(prisma);
  
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
        elementTypeDefaultNaves,
        fallbackNaveId,
      });
    });
  
    log.info({ lampId: lamp.id }, "lamp elements updated");
    revalidatePath("/dashboard/proyectos");
    revalidatePath(`/dashboard/proyectos/${lamp.projectId}`);
    return { id: lamp.id };
    },
    (result) => ({ summary: "Actualizar elementos de lámpara", entityType: "Lamp", entityId: input.lampId }),
  );
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
  return runAuditedMutation(
    "projects.updateLampFrames",
    async () => {
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
    },
    (result) => ({ summary: "Actualizar bastidores", entityType: "Lamp", entityId: input.lampId }),
  );
}

export async function renameLamp(input: z.infer<typeof renameLampSchema>) {
  return runAuditedMutation(
    "projects.renameLamp",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = renameLampSchema.parse(input);
  
    const lamp = await prisma.lamp.findFirst({
      where: { id: data.lampId },
      select: { id: true, projectId: true },
    });
    if (!lamp) throw new Error("Lámpara no encontrada");
  
    await persistLampName(
      {
        projectId: lamp.projectId,
        name: data.name,
        excludeLampId: lamp.id,
        confirmSimilarName: data.confirmSimilarName,
      },
      async (fields) => {
        await prisma.lamp.update({
          where: { id: lamp.id },
          data: { name: fields.name, nameKey: fields.nameKey },
        });
      },
    );
  
    revalidatePath("/dashboard/proyectos");
    revalidatePath(`/dashboard/proyectos/${lamp.projectId}`);
    },
    (result) => ({ summary: "Renombrar lámpara", entityType: "Lamp", entityId: input.lampId }),
  );
}

const updateTaskHoursSchema = z.object({
  taskId: z.string().min(1),
  estimatedHours: z.number().positive(),
});

export async function updateTaskHours(input: z.infer<typeof updateTaskHoursSchema>) {
  return runAuditedMutation(
    "projects.updateTaskHours",
    async () => {
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
    },
    (result) => ({ summary: "Actualizar horas de tarea", entityType: "Task", entityId: input.taskId }),
  );
}

const addExtraTaskSchema = z.object({
  lampId: z.string().min(1),
  process: z.string().min(1),
  estimatedHours: z.number().positive(),
  elementGroupKey: z.string().min(1).optional(),
  naveId: z.string().min(1).optional(),
});

export async function addExtraTask(input: z.infer<typeof addExtraTaskSchema>) {
  return runAuditedMutation(
    "projects.addExtraTask",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = addExtraTaskSchema.parse(input);
  
    const lamp = await prisma.lamp.findFirst({
      where: { id: data.lampId },
      select: { id: true, projectId: true, elementTypeId: true },
    });
    if (!lamp) throw new Error("Lámpara no encontrada");
  
    const { fallbackNaveId, elementTypeDefaultNaves } =
      await loadTaskNaveContext(prisma);
  
    async function resolveExtraTaskNaveId(elementTypeId: string | null) {
      if (data.naveId) {
        await assertActiveNaveId(data.naveId);
        return data.naveId;
      }
      return resolveNaveForElementType(
        elementTypeId,
        elementTypeDefaultNaves,
        fallbackNaveId,
      );
    }
  
    if (data.elementGroupKey) {
      const elementTypeId = elementTypeIdFromGroupKey(data.elementGroupKey);
      const exists = await prisma.task.count({
        where: elementTaskScopeWhere({
          lampId: lamp.id,
          elementTypeId,
          process: data.process,
        }),
      });
      if (exists > 0) {
        throw new Error("Ese proceso ya existe en este elemento.");
      }
  
      const naveId = await resolveExtraTaskNaveId(elementTypeId);
  
      await prisma.$transaction(async (tx) => {
        let order = await getNextTaskOrder(tx, lamp.id);
  
        if (elementTypeId === null) {
          await tx.task.create({
            data: {
              projectId: lamp.projectId,
              lampId: lamp.id,
              lampElementId: null,
              process: data.process,
              estimatedHours: data.estimatedHours,
              order,
              naveId,
            },
          });
          return;
        }
  
        const lampElements = await tx.lampElement.findMany({
          where: { lampId: lamp.id, elementTypeId },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        if (lampElements.length === 0) {
          throw new Error("No hay unidades en este elemento.");
        }
  
        for (const lampElement of lampElements) {
          await tx.task.create({
            data: {
              projectId: lamp.projectId,
              lampId: lamp.id,
              lampElementId: lampElement.id,
              process: data.process,
              estimatedHours: data.estimatedHours,
              order: order++,
              naveId,
            },
          });
        }
      });
  
      revalidatePath("/dashboard/proyectos");
      return;
    }
  
    const primaryLampElement = lamp.elementTypeId
      ? await prisma.lampElement.findFirst({
          where: { lampId: lamp.id, elementTypeId: lamp.elementTypeId },
          select: { id: true },
        })
      : null;
  
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
  
    const naveId = await resolveExtraTaskNaveId(lamp.elementTypeId);
  
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
    },
    { summary: "Añadir tarea extra", entityType: "Task" },
  );
}

const updateTaskNaveSchema = z.object({
  taskId: z.string().min(1),
  naveId: z.string().min(1),
});

export async function updateTaskNave(input: z.infer<typeof updateTaskNaveSchema>) {
  return runAuditedMutation(
    "projects.updateTaskNave",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = updateTaskNaveSchema.parse(input);
    await persistTasksNave([data.taskId], data.naveId);
    },
    (result) => ({ summary: "Cambiar nave de tarea", entityType: "Task", entityId: input.taskId }),
  );
}

const bulkAssignTasksNaveSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1),
  naveId: z.string().min(1),
});

export async function bulkAssignTasksNave(
  input: z.infer<typeof bulkAssignTasksNaveSchema>,
) {
  return runAuditedMutation(
    "projects.bulkAssignTasksNave",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = bulkAssignTasksNaveSchema.parse(input);
    await persistTasksNave(data.taskIds, data.naveId);
    },
    { summary: "Asignar nave en bloque", entityType: "Task" },
  );
}

const assignElementTasksNaveSchema = z.object({
  lampId: z.string().min(1),
  elementGroupKey: z.string().min(1),
  naveId: z.string().min(1),
});

export async function assignElementTasksNave(
  input: z.infer<typeof assignElementTasksNaveSchema>,
) {
  return runAuditedMutation(
    "projects.assignElementTasksNave",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = assignElementTasksNaveSchema.parse(input);
    const taskIds = await loadScopedTaskIds({
      lampId: data.lampId,
      elementTypeId: elementTypeIdFromGroupKey(data.elementGroupKey),
    });
    await persistTasksNave(taskIds, data.naveId);
    },
    (result) => ({ summary: "Asignar nave a elemento", entityType: "Lamp", entityId: input.lampId }),
  );
}

const assignProcessTasksNaveSchema = z.object({
  lampId: z.string().min(1),
  elementGroupKey: z.string().min(1),
  process: z.string().min(1),
  naveId: z.string().min(1),
});

export async function assignProcessTasksNave(
  input: z.infer<typeof assignProcessTasksNaveSchema>,
) {
  return runAuditedMutation(
    "projects.assignProcessTasksNave",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = assignProcessTasksNaveSchema.parse(input);
    const taskIds = await loadScopedTaskIds({
      lampId: data.lampId,
      elementTypeId: elementTypeIdFromGroupKey(data.elementGroupKey),
      process: data.process,
    });
    await persistTasksNave(taskIds, data.naveId);
    },
    { summary: "Asignar nave a proceso", entityType: "Task" },
  );
}

const applyDefaultNavesSchema = z.object({
  lampId: z.string().min(1),
  elementGroupKey: z.string().min(1),
});

export async function applyDefaultNavesToElement(
  input: z.infer<typeof applyDefaultNavesSchema>,
) {
  return runAuditedMutation(
    "projects.applyDefaultNavesToElement",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = applyDefaultNavesSchema.parse(input);
    const elementTypeId = elementTypeIdFromGroupKey(data.elementGroupKey);
    const { fallbackNaveId, elementTypeDefaultNaves } =
      await loadTaskNaveContext(prisma);
    const defaultNaveId = resolveNaveForElementType(
      elementTypeId,
      elementTypeDefaultNaves,
      fallbackNaveId,
    );
    const tasks = await prisma.task.findMany({
      where: elementTaskScopeWhere({
        lampId: data.lampId,
        elementTypeId,
      }),
      select: {
        id: true,
        lamp: { select: { projectId: true } },
        _count: { select: { assignments: true } },
      },
    });
  
    if (tasks.some((task) => task._count.assignments > 0)) {
      throw new Error(
        "Alguna tarea tiene asignaciones de planning; no se puede cambiar la nave.",
      );
    }
  
    await prisma.$transaction(
      tasks.map((task) =>
        prisma.task.update({
          where: { id: task.id },
          data: { naveId: defaultNaveId },
        }),
      ),
    );
  
    const projectIds = new Set(tasks.map((task) => task.lamp.projectId));
    revalidatePath("/dashboard/proyectos");
    for (const projectId of projectIds) {
      revalidatePath(`/dashboard/proyectos/${projectId}`);
    }
    },
    (result) => ({ summary: "Aplicar naves por defecto", entityType: "Lamp", entityId: input.lampId }),
  );
}

const deleteProcessTasksSchema = z.object({
  lampId: z.string().min(1),
  elementGroupKey: z.string().min(1),
  process: z.string().min(1),
});

export async function deleteProcessTasks(
  input: z.infer<typeof deleteProcessTasksSchema>,
) {
  return runAuditedMutation(
    "projects.deleteProcessTasks",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = deleteProcessTasksSchema.parse(input);
  
    const tasks = await prisma.task.findMany({
      where: elementTaskScopeWhere({
        lampId: data.lampId,
        elementTypeId: elementTypeIdFromGroupKey(data.elementGroupKey),
        process: data.process,
      }),
      include: { _count: { select: { assignments: true, timeEntries: true } } },
    });
  
    if (tasks.length === 0) {
      throw new Error("No hay tareas de ese proceso en este elemento.");
    }
  
    if (tasks.some((task) => task._count.timeEntries > 0)) {
      throw new Error("No se puede eliminar: alguna tarea tiene horas registradas.");
    }
    if (tasks.some((task) => task._count.assignments > 0)) {
      throw new Error(
        "No se puede eliminar: alguna tarea tiene asignaciones de planning.",
      );
    }
  
    await prisma.task.deleteMany({
      where: { id: { in: tasks.map((task) => task.id) } },
    });
    revalidatePath("/dashboard/proyectos");
    },
    { summary: "Eliminar tareas de proceso", entityType: "Task" },
  );
}

const deleteTaskSchema = z.object({ taskId: z.string().min(1) });

export async function deleteTask(input: z.infer<typeof deleteTaskSchema>) {
  return runAuditedMutation(
    "projects.deleteTask",
    async () => {
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
    },
    (result) => ({ summary: "Eliminar tarea", entityType: "Task", entityId: input.taskId }),
  );
}

const updateTaskNotesSchema = z.object({
  taskId: z.string().min(1),
  notes: z.string().max(500).nullable(),
});

export async function updateTaskNotes(input: z.infer<typeof updateTaskNotesSchema>) {
  return runAuditedMutation(
    "projects.updateTaskNotes",
    async () => {
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
    },
    (result) => ({ summary: "Actualizar notas de tarea", entityType: "Task", entityId: input.taskId }),
  );
}

const reorderTaskSchema = z.object({
  taskId: z.string().min(1),
  direction: z.enum(["up", "down"]),
});

export async function reorderTask(input: z.infer<typeof reorderTaskSchema>) {
  return runAuditedMutation(
    "projects.reorderTask",
    async () => {
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
    },
    (result) => ({ summary: "Reordenar tarea", entityType: "Task", entityId: input.taskId }),
  );
}

const deleteLampSchema = z.object({ lampId: z.string().min(1) });

export async function deleteLamp(input: z.infer<typeof deleteLampSchema>) {
  return runAuditedMutation(
    "projects.deleteLamp",
    async () => {
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
    },
    (result) => ({ summary: "Eliminar lámpara", entityType: "Lamp", entityId: input.lampId }),
  );
}

const toggleSchema = z.object({ projectId: z.string().min(1), isActive: z.boolean() });

export async function toggleProjectActive(input: z.infer<typeof toggleSchema>) {
  return runAuditedMutation(
    "projects.toggleProjectActive",
    async () => {
  const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = toggleSchema.parse(input);
    await prisma.project.update({
      where: { id: data.projectId },
      data: { isActive: data.isActive },
    });
    revalidatePath("/dashboard/proyectos");
    },
    (result) => ({ summary: "Activar/desactivar proyecto", entityType: "Project", entityId: input.projectId }),
  );
}

const deleteProjectSchema = z.object({ projectId: z.string().min(1) });

export async function deleteProject(input: z.infer<typeof deleteProjectSchema>) {
  return runAuditedMutation(
    "projects.deleteProject",
    async () => {
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
    },
    (result) => ({ summary: "Eliminar proyecto", entityType: "Project", entityId: input.projectId }),
  );
}

const updateProjectStrategySchema = z.object({
  projectId: z.string().min(1),
  strategy: projectPlanningStrategySchema,
});

export async function updateProjectPlanningStrategy(
  input: z.infer<typeof updateProjectStrategySchema>,
) {
  return runAuditedMutation(
    "projects.updateProjectPlanningStrategy",
    async () => {
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
    },
    (result) => ({ summary: "Actualizar estrategia planning", entityType: "Project", entityId: input.projectId }),
  );
}

const applyProjectPresetSchema = z.object({
  projectId: z.string().min(1),
  preset: z.nativeEnum(ProjectPlanningPreset),
});

export async function applyProjectPlanningPreset(
  input: z.infer<typeof applyProjectPresetSchema>,
) {
  return runAuditedMutation(
    "projects.applyProjectPlanningPreset",
    async () => {
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
    },
    (result) => ({ summary: "Aplicar preset planning", entityType: "Project", entityId: input.projectId }),
  );
}

const applyGlobalPresetSchema = z.object({
  preset: z.nativeEnum(ProjectPlanningPreset),
});

export async function applyGlobalPlanningPresetToActiveProjects(
  input: z.infer<typeof applyGlobalPresetSchema>,
) {
  return runAuditedMutation(
    "projects.applyGlobalPlanningPreset",
    async () => {
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
    },
    { summary: "Aplicar preset global", entityType: "Project" },
  );
}
