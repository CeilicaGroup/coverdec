"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { childLogger } from "@/lib/logger";
import { ProductionOrderKind, Role } from "@/generated/prisma";
import { getCoordinatedPlanningNaveIds } from "@/features/planning/coordinated-naves";
import {
  generateWorkOrdersFromPlanning,
  previewWorkOrdersFromPlanning,
} from "./group-from-planning";
import { createProductionOrderSchema } from "./schema";

const log = childLogger({ module: "production-orders.actions" });

const planningWeekSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(53),
});

export async function previewWorkOrdersFromPlanningAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.previewWorkOrdersFromPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = planningWeekSchema.parse(input);
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      const batches = await previewWorkOrdersFromPlanning({
        naveIds,
        year: data.year,
        week: data.week,
      });
      return { batches };
    },
    { summary: "Vista previa de OT desde planning" },
  );
}

export async function generateWorkOrdersFromPlanningAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.generateWorkOrdersFromPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = planningWeekSchema.parse(input);
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      const result = await generateWorkOrdersFromPlanning({
        naveIds,
        year: data.year,
        week: data.week,
      });
      log.info(result, "work orders generated from planning");
      revalidatePath("/dashboard/ordenes");
      return result;
    },
    (result) => ({
      summary: `Generar ${result.created} OT desde planning`,
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function createProductionOrder(
  input: Parameters<typeof createProductionOrderSchema.parse>[0],
) {
  return runAuditedMutation(
    "production-orders.createProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createProductionOrderSchema.parse(input);

      const lines =
        data.lines ??
        (data.projectId
          ? [{ projectId: data.projectId, units: 1 }]
          : []);

      if (lines.length === 0) {
        throw new Error("Indica al menos una línea de destino (proyecto y unidades)");
      }

      const year = new Date().getUTCFullYear();
      const last = await prisma.productionOrder.findFirst({
        where: { year },
        orderBy: { serial: "desc" },
      });
      const serial = (last?.serial ?? 0) + 1;
      const number = `OP${String(serial).padStart(4, "0")}-${year}`;
      const headerProjectId =
        data.projectId ?? lines.find((l) => l.projectId)?.projectId;

      const order = await prisma.productionOrder.create({
        data: {
          number,
          year,
          serial,
          kind: data.kind ?? ProductionOrderKind.PROYECTO,
          projectId: headerProjectId,
          lampLabel: data.lampLabel,
          process: data.process,
          hours: data.hours,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
          naveId: data.naveId,
          elementTypeId: data.elementTypeId,
          notes: data.notes,
          lines: {
            create: lines.map((line) => ({
              projectId: line.projectId,
              clientLabel: line.clientLabel,
              units: line.units,
              ral: line.ral,
              colorHex: line.colorHex,
            })),
          },
        },
        include: { lines: true },
      });

      log.info(
        { id: order.id, number, lineCount: order.lines.length },
        "production order created",
      );
      revalidatePath("/dashboard/ordenes");
      return { id: order.id, number };
    },
    (result) => ({
      summary: `Crear orden de producción ${result.number}`,
      entityType: "ProductionOrder",
      entityId: result.id,
      metadata: input as Record<string, unknown>,
    }),
  );
}
