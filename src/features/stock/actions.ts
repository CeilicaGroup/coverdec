"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { childLogger } from "@/lib/logger";
import { Role } from "@/generated/prisma";
import {
  assignStockToProjectTx,
  cancelProductionOrderLineTx,
} from "./assign-to-project";
import {
  assignStockToProjectSchema,
  cancelOrderLineSchema,
} from "./schema";

const log = childLogger({ module: "stock.actions" });

function revalidateStockPaths() {
  revalidatePath("/dashboard/almacen");
  revalidatePath("/dashboard/cancelaciones");
  revalidatePath("/dashboard/ordenes");
  revalidatePath("/dashboard/horas");
}

export async function assignStockToProjectAction(input: unknown) {
  return runAuditedMutation(
    "stock.assignStockToProject",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = assignStockToProjectSchema.parse(input);

      const result = await prisma.$transaction((tx) =>
        assignStockToProjectTx(tx, {
          stockItemId: data.stockItemId,
          projectId: data.projectId,
          units: data.units,
          ral: data.ral,
          colorHex: data.colorHex,
          userId: ctx.userId,
        }),
      );

      log.info({ ...data, ...result }, "stock assigned to project");
      revalidateStockPaths();
      return result;
    },
    (result) => ({
      summary: "Asignar stock a proyecto",
      entityType: "StockItem",
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function cancelProductionOrderLineAction(input: unknown) {
  return runAuditedMutation(
    "stock.cancelProductionOrderLine",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = cancelOrderLineSchema.parse(input);

      const line = await prisma.productionOrderLine.findFirst({
        where: { id: data.lineId, orderId: data.orderId },
        select: { units: true },
      });
      if (!line) throw new Error("Línea no encontrada.");

      const result = await prisma.$transaction((tx) =>
        cancelProductionOrderLineTx(tx, {
          orderId: data.orderId,
          lineId: data.lineId,
          unitsToCancel: data.units ?? line.units,
          userId: ctx.userId,
        }),
      );

      log.info({ ...data, ...result }, "production order line cancelled");
      revalidateStockPaths();
      return result;
    },
    (result) => ({
      summary: "Cancelar línea de orden de producción",
      entityType: "ProductionOrderLine",
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}
