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
      elementType: { select: { name: true } },
      elements: {
        select: {
          id: true,
          label: true,
          stockStatus: true,
          stockBatchCode: true,
          elementType: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      tasks: {
        select: {
          id: true,
          estimatedHours: true,
          isCompleted: true,
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
    return {
      id: lamp.id,
      name: lamp.name,
      elementTypeName: lamp.elementType?.name ?? null,
      stockStatus,
      batchCodes,
      pendingHours,
      returnedToStockAt: lamp.returnedToStockAt,
      returnedToStockReason: lamp.returnedToStockReason,
      previousProject: lamp.previousProject,
      elements: lamp.elements,
    };
  });
}

const returnLampToStockSchema = z.object({
  lampId: z.string().min(1),
  reason: z.string().max(500).optional(),
  confirmClearPlanning: z.boolean().optional(),
});

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
          elements: { select: { id: true } },
          tasks: {
            select: {
              id: true,
              _count: { select: { assignments: true } },
            },
          },
        },
      });
      if (!lamp) throw new Error("Lámpara no encontrada.");
      if (isStockProjectKind(lamp.project.kind)) {
        throw new Error("La lámpara ya está en el pool de stock.");
      }

      const hasPlanning = lamp.tasks.some(
        (task) => task._count.assignments > 0,
      );
      if (hasPlanning && !data.confirmClearPlanning) {
        throw new Error(
          "La lámpara tiene asignaciones de planning. Confirma para eliminarlas al devolver a stock.",
        );
      }

      await prisma.$transaction(async (tx) => {
        if (hasPlanning) {
          await deletePlanningAssignmentsForLamp(tx, lamp.id);
        }
        await clearPendingTaskWorkOrders(tx, lamp.id);

        await tx.lampElement.updateMany({
          where: { lampId: lamp.id },
          data: {
            stockStatus: stockElementStatusForReturn(),
            stockBatchCode: null,
          },
        });

        await tx.lamp.update({
          where: { id: lamp.id },
          data: {
            ...lampReturnToStockFields({
              previousProjectId: lamp.projectId,
              reason: data.reason,
            }),
          },
        });

        await moveLampToProject(tx, {
          lampId: lamp.id,
          targetProjectId: stockPoolProjectId,
        });
      });

      log.info(
        { lampId: lamp.id, fromProjectId: lamp.projectId },
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
