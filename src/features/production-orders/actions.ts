"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { childLogger } from "@/lib/logger";
import { Role } from "@/generated/prisma";

const log = childLogger({ module: "production-orders.actions" });

const createSchema = z.object({
  projectId: z.string().min(1),
  lampLabel: z.string().optional(),
  process: z.string().min(1).optional(),
  hours: z.number().positive().optional(),
  scheduledAt: z.string().optional(),
  notes: z.string().optional(),
});

export async function createProductionOrder(input: z.infer<typeof createSchema>) {
  return runAuditedMutation(
    "production-orders.createProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createSchema.parse(input);
      const project = await prisma.project.findFirst({
        where: { id: data.projectId, isActive: true },
        select: { id: true },
      });
      if (!project) throw new Error("Proyecto no encontrado o inactivo.");
      const year = new Date().getUTCFullYear();
      const order = await prisma.$transaction(async (tx) => {
        // «Máx + 1» serializado: dos creaciones a la vez no pueden leer el mismo máximo.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`production-order-number:${year}`}))`;
        const last = await tx.productionOrder.findFirst({
          where: { year },
          orderBy: { serial: "desc" },
          select: { serial: true },
        });
        const serial = (last?.serial ?? 0) + 1;
        return tx.productionOrder.create({
          data: {
            number: `OP${String(serial).padStart(4, "0")}-${year}`,
            year,
            serial,
            projectId: data.projectId,
            lampLabel: data.lampLabel,
            process: data.process,
            hours: data.hours,
            scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
            notes: data.notes,
          },
        });
      });
      const number = order.number;
      log.info({ id: order.id, number }, "production order created");
      revalidatePath("/dashboard/ordenes");
      return { id: order.id, number };
    },
    (result) => ({
      summary: `Crear orden de producción ${result.number}`,
      entityType: "ProductionOrder",
      entityId: result.id,
      metadata: input,
    }),
  );
}
