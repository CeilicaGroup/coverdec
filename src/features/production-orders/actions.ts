"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import {Role } from "@/generated/prisma";

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
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = createSchema.parse(input);
  const year = new Date().getUTCFullYear();
  const last = await prisma.productionOrder.findFirst({
    where: { empresaId: ctx.empresaId, year },
    orderBy: { serial: "desc" },
  });
  const serial = (last?.serial ?? 0) + 1;
  const number = `OP${String(serial).padStart(4, "0")}-${year}`;
  const order = await prisma.productionOrder.create({
    data: {
      empresaId: ctx.empresaId,
      number,
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
  log.info({ id: order.id, number }, "production order created");
  revalidatePath("/dashboard/ordenes");
  return { id: order.id, number };
}
