import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { LampElementStockStatus, Role } from "@/generated/prisma";
import { IMPREVISTAS_LAMP_NAME_KEY } from "@/features/ad-hoc/constants";
import { isStockLampAssignable } from "./stock-assignable";
import { getStockPoolProjectId } from "./stock-pool";

export function stockLampCanHardDelete(
  tasks: Array<{ _count: { timeEntries: number } }>,
): boolean {
  return !tasks.some((task) => task._count.timeEntries > 0);
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

export async function listAssignableStockLamps() {
  const lamps = await listStockLamps();
  return lamps.filter((lamp) => isStockLampAssignable(lamp.stockStatus));
}
