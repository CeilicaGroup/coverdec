"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import {
  LampElementStockStatus,
  ProjectKind,
  Role,
  type Prisma,
} from "@/generated/prisma";
import {
  createLampInputSchema,
  lampElementInputSchema,
} from "@/features/projects/create-lamp-input";
import {
  assertLampNameAllowed,
  isPrismaUniqueViolation,
  lampNameFields,
} from "@/features/projects/lamp-name-validation";
import {
  buildTasksFromElement,
  formatLampElementUnitLabel,
} from "@/features/projects/lamp-tasks";
import {
  blueprintToTaskCreateData,
  syncTransportTasksForLamp,
} from "@/features/projects/transport-tasks";
import { isStockProjectKind } from "@/lib/project-kind";
import { IMPREVISTAS_LAMP_NAME_KEY } from "@/features/ad-hoc/constants";
import { isStockLampAssignable } from "./stock-assignable";
import { getStockPoolProjectId } from "./stock-pool";
import {
  clearPendingTaskWorkOrders,
  deletePlanningAssignmentsForLamp,
  lampAssignFromStockFields,
  lampReturnToStockFields,
  moveLampToProject,
  nextStockBatchCode,
  stockElementStatusForAssign,
  stockElementStatusForProduction,
  stockElementStatusForReturn,
} from "./move-lamp";
import { tryAttachLampTasksToOpenWorkOrder } from "./attach-work-order";

const log = childLogger({ module: "stock.actions" });

function stockLampCanHardDelete(
  tasks: Array<{ _count: { timeEntries: number } }>,
): boolean {
  return !tasks.some((task) => task._count.timeEntries > 0);
}

function assertUniqueElementTypes(elements: { elementTypeId: string }[]) {
  const ids = elements.map((element) => element.elementTypeId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("No puedes repetir el mismo tipo de elemento en una lámpara.");
  }
}

const createStockBatchSchema = createLampInputSchema
  .omit({ projectId: true })
  .extend({
    elements: z.array(lampElementInputSchema).min(1),
  });

export async function createStockBatch(
  input: z.infer<typeof createStockBatchSchema>,
) {
  return runAuditedMutation(
    "stock.createStockBatch",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createStockBatchSchema.parse(input);
      const stockPoolProjectId = await getStockPoolProjectId();

      const elements = data.elements;
      assertUniqueElementTypes(elements);

      const elementTypeIds = [...new Set(elements.map((element) => element.elementTypeId))];
      const elementTypes = await prisma.elementType.findMany({
        where: { id: { in: elementTypeIds } },
        select: { id: true, name: true, typology: true },
      });
      const elementNameById = new Map(elementTypes.map((element) => [element.id, element.name]));
      const typologyById = new Map(elementTypes.map((element) => [element.id, element.typology]));
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
      const totalUnits = elements.reduce((sum, element) => sum + element.units, 0);
      const fields = lampNameFields(data.name);
      if (!fields.nameKey) {
        throw new Error("El nombre de la lámpara no es válido.");
      }

      await assertLampNameAllowed(prisma, {
        projectId: stockPoolProjectId,
        name: data.name,
        confirmSimilarName: data.confirmSimilarName,
      });

      let lampId = "";
      try {
        lampId = await prisma.$transaction(async (tx) => {
          const stockBatchCode = await nextStockBatchCode(tx);
          const created = await tx.lamp.create({
            data: {
              projectId: stockPoolProjectId,
              name: fields.name,
              nameKey: fields.nameKey,
              elementTypeId: primary.elementTypeId,
              surfaceM2: primary.surfaceM2,
              units: totalUnits,
            },
          });

          const tasksToCreate: Array<ReturnType<typeof blueprintToTaskCreateData>> = [];
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
                  stockStatus: stockElementStatusForProduction(),
                  stockBatchCode,
                },
              });

              for (const blueprint of blueprints) {
                tasksToCreate.push(
                  blueprintToTaskCreateData(blueprint, {
                    projectId: stockPoolProjectId,
                    lampId: created.id,
                    lampElementId: lampElement.id,
                    order: blueprint.order + physicalElementIndex * 1000,
                  }),
                );
              }
              physicalElementIndex += 1;
            }
          }

          if (tasksToCreate.length > 0) {
            await tx.task.createMany({ data: tasksToCreate });
          }
          await syncTransportTasksForLamp(tx, created.id);
          return created.id;
        });
      } catch (error) {
        if (isPrismaUniqueViolation(error)) {
          throw new Error(
            "Ya existe una lámpara con ese nombre en el pool de stock.",
          );
        }
        throw error;
      }

      log.info({ lampId, stockBatch: true }, "stock batch created");
      revalidatePath("/dashboard/stock");
      return { id: lampId };
    },
    (result) => ({
      summary: "Crear lote de stock",
      entityType: "Lamp",
      entityId: result.id,
    }),
  );
}

export async function listStockLamps() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const stockPoolProjectId = await getStockPoolProjectId();
  const lamps = await prisma.lamp.findMany({
    where: {
      projectId: stockPoolProjectId,
      nameKey: { not: IMPREVISTAS_LAMP_NAME_KEY },
      elements: {
        some: {
          stockStatus: {
            in: [
              LampElementStockStatus.IN_PRODUCTION,
              LampElementStockStatus.AVAILABLE,
            ],
          },
        },
      },
    },
    include: {
      elementType: { select: { id: true, name: true, typology: true } },
      elements: {
        select: {
          id: true,
          label: true,
          stockStatus: true,
          stockBatchCode: true,
          elementTypeId: true,
          elementType: { select: { id: true, name: true, typology: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        select: {
          id: true,
          estimatedHours: true,
          isCompleted: true,
          _count: { select: { timeEntries: true } },
        },
      },
      previousProject: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ returnedToStockAt: "desc" }, { name: "asc" }],
  });

  return lamps.map((lamp) => {
    const pendingHours = lamp.tasks
      .filter((task) => !task.isCompleted)
      .reduce((sum, task) => sum + task.estimatedHours, 0);
    const batchCodes = [
      ...new Set(
        lamp.elements
          .map((element) => element.stockBatchCode)
          .filter((code): code is string => Boolean(code)),
      ),
    ];
    const stockStatus =
      lamp.elements.find((element) => element.stockStatus)?.stockStatus ?? null;
    const primaryElementType =
      lamp.elementType ??
      lamp.elements.find((element) => element.elementType)?.elementType ??
      null;
    return {
      id: lamp.id,
      name: lamp.name,
      elementTypeName: primaryElementType?.name ?? null,
      elementTypeId: primaryElementType?.id ?? null,
      elementTypology: primaryElementType?.typology ?? null,
      stockStatus,
      batchCodes,
      pendingHours,
      returnedToStockAt: lamp.returnedToStockAt,
      returnedToStockReason: lamp.returnedToStockReason,
      previousProject: lamp.previousProject,
      elements: lamp.elements,
      canHardDelete: stockLampCanHardDelete(lamp.tasks),
    };
  });
}

const returnLampToStockSchema = z.object({
  lampId: z.string().min(1),
  reason: z.string().max(500).optional(),
  confirmClearPlanning: z.boolean().optional(),
  lampElementIds: z.array(z.string().min(1)).min(1).optional(),
});

function taskHasPlanningAssignments(
  task: { _count: { assignments: number } },
): boolean {
  return task._count.assignments > 0;
}

async function returnWholeLampToStock(
  tx: Prisma.TransactionClient,
  args: {
    lamp: {
      id: string;
      projectId: string;
    };
    stockPoolProjectId: string;
    reason?: string;
    previousProjectId: string;
    confirmClearPlanning?: boolean;
    tasks: Array<{ _count: { assignments: number } }>;
  },
): Promise<void> {
  const hasPlanning = args.tasks.some(taskHasPlanningAssignments);
  if (hasPlanning && !args.confirmClearPlanning) {
    throw new Error(
      "La lámpara tiene asignaciones de planning. Confirma para eliminarlas al devolver a stock.",
    );
  }

  if (hasPlanning) {
    await deletePlanningAssignmentsForLamp(tx, args.lamp.id);
  }
  await clearPendingTaskWorkOrders(tx, args.lamp.id);

  await tx.lampElement.updateMany({
    where: { lampId: args.lamp.id },
    data: {
      stockStatus: stockElementStatusForReturn(),
      stockBatchCode: null,
    },
  });

  await tx.lamp.update({
    where: { id: args.lamp.id },
    data: lampReturnToStockFields({
      previousProjectId: args.previousProjectId,
      reason: args.reason,
    }),
  });

  await moveLampToProject(tx, {
    lampId: args.lamp.id,
    targetProjectId: args.stockPoolProjectId,
  });
}

export async function returnLampToStock(
  input: z.infer<typeof returnLampToStockSchema>,
) {
  return runAuditedMutation(
    "stock.returnLampToStock",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = returnLampToStockSchema.parse(input);
      const stockPoolProjectId = await getStockPoolProjectId();

      const lamp = await prisma.lamp.findUnique({
        where: { id: data.lampId },
        include: {
          project: { select: { id: true, kind: true, name: true } },
          elements: { orderBy: { createdAt: "asc" } },
          tasks: {
            select: {
              id: true,
              process: true,
              estimatedHours: true,
              order: true,
              naveId: true,
              lampElementId: true,
              notes: true,
              systemKind: true,
              _count: { select: { assignments: true } },
            },
          },
        },
      });
      if (!lamp) throw new Error("Lámpara no encontrada.");
      if (isStockProjectKind(lamp.project.kind)) {
        throw new Error("La lámpara ya está en el pool de stock.");
      }

      const allElementIds = lamp.elements.map((element) => element.id);
      const selectedElementIds =
        data.lampElementIds ??
        (allElementIds.length > 0 ? allElementIds : undefined);

      if (allElementIds.length > 1) {
        if (!data.lampElementIds || data.lampElementIds.length === 0) {
          throw new Error("Selecciona al menos una lámpara para enviar a stock.");
        }
        const unknown = data.lampElementIds.filter(
          (id) => !allElementIds.includes(id),
        );
        if (unknown.length > 0) {
          throw new Error("Alguna de las lámparas seleccionadas no pertenece al grupo.");
        }
      }

      const selectedSet = new Set(selectedElementIds ?? []);
      const elementsToStock =
        allElementIds.length > 0
          ? lamp.elements.filter((element) => selectedSet.has(element.id))
          : [];
      const elementsToKeep =
        allElementIds.length > 0
          ? lamp.elements.filter((element) => !selectedSet.has(element.id))
          : [];

      const isPartialReturn =
        allElementIds.length > 1 && elementsToKeep.length > 0;

      await prisma.$transaction(async (tx) => {
        if (!isPartialReturn) {
          await returnWholeLampToStock(tx, {
            lamp,
            stockPoolProjectId,
            reason: data.reason,
            previousProjectId: lamp.projectId,
            confirmClearPlanning: data.confirmClearPlanning,
            tasks: lamp.tasks,
          });
          return;
        }

        const stockTasks = lamp.tasks.filter(
          (task) =>
            task.lampElementId != null && selectedSet.has(task.lampElementId),
        );
        const selectedHasPlanning = stockTasks.some(taskHasPlanningAssignments);
        if (selectedHasPlanning && !data.confirmClearPlanning) {
          throw new Error(
            "Alguna lámpara seleccionada tiene asignaciones de planning. Confirma para eliminarlas al devolver a stock.",
          );
        }

        const stockName = `${lamp.name} (stock ×${elementsToStock.length})`;
        const stockFields = lampNameFields(stockName);
        const stockLamp = await tx.lamp.create({
          data: {
            projectId: lamp.projectId,
            elementTypeId: elementsToStock[0]!.elementTypeId,
            code: lamp.code,
            name: stockName,
            nameKey: stockFields.nameKey,
            width: lamp.width,
            height: lamp.height,
            depth: lamp.depth,
            units: elementsToStock.length,
            surfaceM2: elementsToStock[0]!.surfaceM2,
            notes: lamp.notes,
          },
        });

        await tx.lampElement.updateMany({
          where: { id: { in: elementsToStock.map((element) => element.id) } },
          data: {
            lampId: stockLamp.id,
            stockStatus: stockElementStatusForReturn(),
            stockBatchCode: null,
          },
        });

        await tx.task.updateMany({
          where: {
            lampElementId: { in: elementsToStock.map((element) => element.id) },
          },
          data: { lampId: stockLamp.id },
        });

        const firstKept = elementsToKeep[0]!;
        await tx.lamp.update({
          where: { id: lamp.id },
          data: {
            units: elementsToKeep.length,
            elementTypeId: firstKept.elementTypeId,
            surfaceM2: firstKept.surfaceM2,
          },
        });

        if (selectedHasPlanning) {
          await deletePlanningAssignmentsForLamp(tx, stockLamp.id);
        }
        await clearPendingTaskWorkOrders(tx, stockLamp.id);

        await tx.lamp.update({
          where: { id: stockLamp.id },
          data: lampReturnToStockFields({
            previousProjectId: lamp.projectId,
            reason: data.reason,
          }),
        });

        await moveLampToProject(tx, {
          lampId: stockLamp.id,
          targetProjectId: stockPoolProjectId,
        });

        await syncTransportTasksForLamp(tx, lamp.id);
      });

      log.info(
        { lampId: lamp.id, fromProjectId: lamp.projectId, partial: isPartialReturn },
        "lamp returned to stock",
      );
      revalidatePath("/dashboard/stock");
      revalidatePath("/dashboard/proyectos");
      revalidatePath(`/dashboard/proyectos/${lamp.projectId}`);
      return { id: lamp.id };
    },
    (result) => ({
      summary: "Devolver lámpara a stock",
      entityType: "Lamp",
      entityId: result.id,
    }),
  );
}

const assignLampFromStockSchema = z.object({
  lampId: z.string().min(1),
  targetProjectId: z.string().min(1),
  newName: z.string().min(1).max(120).optional(),
  confirmSimilarName: z.boolean().optional(),
});

export async function assignLampFromStockToProject(
  input: z.infer<typeof assignLampFromStockSchema>,
) {
  return runAuditedMutation(
    "stock.assignLampFromStockToProject",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = assignLampFromStockSchema.parse(input);
      const stockPoolProjectId = await getStockPoolProjectId();

      const [lamp, targetProject] = await Promise.all([
        prisma.lamp.findUnique({
          where: { id: data.lampId },
          include: {
            project: { select: { id: true, kind: true } },
            elements: {
              select: { stockStatus: true },
            },
          },
        }),
        prisma.project.findFirst({
          where: { id: data.targetProjectId, isActive: true },
          select: { id: true, kind: true, name: true },
        }),
      ]);

      if (!lamp) throw new Error("Lámpara no encontrada.");
      if (lamp.projectId !== stockPoolProjectId) {
        throw new Error("La lámpara no pertenece al pool de stock.");
      }
      const stockStatus = lamp.elements.find((e) => e.stockStatus)?.stockStatus;
      if (!isStockLampAssignable(stockStatus)) {
        throw new Error("La lámpara no se puede asignar desde stock.");
      }
      if (!targetProject) throw new Error("Proyecto destino no encontrado.");
      if (isStockProjectKind(targetProject.kind)) {
        throw new Error("No puedes asignar stock al pool interno.");
      }

      const nextName = data.newName?.trim() || lamp.name;
      await assertLampNameAllowed(prisma, {
        projectId: targetProject.id,
        name: nextName,
        confirmSimilarName: data.confirmSimilarName,
      });
      const nameFields = lampNameFields(nextName);
      if (!nameFields.nameKey) {
        throw new Error("El nombre de la lámpara no es válido.");
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.lampElement.updateMany({
            where: { lampId: lamp.id },
            data: {
              stockStatus: stockElementStatusForAssign(),
              stockBatchCode: null,
            },
          });

          await tx.lamp.update({
            where: { id: lamp.id },
            data: {
              name: nameFields.name,
              nameKey: nameFields.nameKey,
              ...lampAssignFromStockFields(),
            },
          });

          await moveLampToProject(tx, {
            lampId: lamp.id,
            targetProjectId: targetProject.id,
          });

          await syncTransportTasksForLamp(tx, lamp.id);
          await tryAttachLampTasksToOpenWorkOrder(tx, {
            projectId: targetProject.id,
            lampId: lamp.id,
          });
        });
      } catch (error) {
        if (isPrismaUniqueViolation(error)) {
          throw new Error(
            "Ya existe una lámpara con ese nombre en el proyecto destino.",
          );
        }
        throw error;
      }

      log.info(
        { lampId: lamp.id, targetProjectId: targetProject.id },
        "lamp assigned from stock",
      );
      revalidatePath("/dashboard/stock");
      revalidatePath("/dashboard/proyectos");
      revalidatePath(`/dashboard/proyectos/${targetProject.id}`);
      return { id: lamp.id, projectId: targetProject.id };
    },
    (result) => ({
      summary: "Asignar lámpara desde stock",
      entityType: "Lamp",
      entityId: result.id,
    }),
  );
}


export async function listAssignableStockLamps() {
  const lamps = await listStockLamps();
  return lamps.filter((lamp) => isStockLampAssignable(lamp.stockStatus));
}

const deleteStockLampSchema = z.object({ lampId: z.string().min(1) });

export async function deleteStockLamp(
  input: z.infer<typeof deleteStockLampSchema>,
) {
  return runAuditedMutation(
    "stock.deleteStockLamp",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const { lampId } = deleteStockLampSchema.parse(input);
      const stockPoolProjectId = await getStockPoolProjectId();

      const lamp = await prisma.lamp.findFirst({
        where: { id: lampId, projectId: stockPoolProjectId },
        include: {
          elements: { select: { stockStatus: true } },
          tasks: {
            include: {
              _count: { select: { timeEntries: true } },
            },
          },
        },
      });
      if (!lamp) {
        throw new Error("La lámpara no pertenece al pool de stock.");
      }

      const stockStatus =
        lamp.elements.find((element) => element.stockStatus)?.stockStatus ?? null;
      if (stockStatus === LampElementStockStatus.ASSIGNED) {
        throw new Error("La lámpara ya fue asignada a un proyecto.");
      }

      if (!stockLampCanHardDelete(lamp.tasks)) {
        throw new Error(
          "No se puede eliminar: hay horas registradas en las tareas de esta lámpara.",
        );
      }

      await prisma.$transaction(async (tx) => {
        await deletePlanningAssignmentsForLamp(tx, lamp.id);
        await clearPendingTaskWorkOrders(tx, lamp.id);
        await tx.lamp.delete({ where: { id: lamp.id } });
      });

      log.info({ lampId }, "stock lamp deleted");
      revalidatePath("/dashboard/stock");
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/semana");
      revalidatePath("/dashboard/persona");
      revalidatePath("/dashboard/proyecto");
    },
    ( ) => ({
      summary: "Eliminar lámpara de stock",
      entityType: "Lamp",
      entityId: input.lampId,
    }),
  );
}
