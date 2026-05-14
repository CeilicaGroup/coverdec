"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { FactoryStatus, Role } from "@/generated/prisma";

const log = childLogger({ module: "factory.actions" });

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(FactoryStatus).optional(),
  nave: z.string().optional(),
  notes: z.string().optional(),
  scheduledAt: z.string().optional(),
});

export async function updateFactoryItem(input: z.infer<typeof updateSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateSchema.parse(input);
  const item = await prisma.factoryItem.findFirstOrThrow({
    where: { id: data.id, empresaId: ctx.empresaId },
  });
  await prisma.factoryItem.update({
    where: { id: item.id },
    data: {
      status: data.status,
      nave: data.nave,
      notes: data.notes,
      scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
      shippedAt:
        data.status === FactoryStatus.ENVIADO ? new Date() : item.shippedAt,
    },
  });
  log.info({ id: item.id, status: data.status }, "factory item updated");
  revalidatePath("/dashboard/fabrica");
}

const createSchema = z.object({
  product: z.string().min(1),
  obra: z.string().optional(),
  nave: z.string().optional(),
  code: z.string().optional(),
  status: z.nativeEnum(FactoryStatus).default(FactoryStatus.DOSSIER),
});

export async function createFactoryItem(input: z.infer<typeof createSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = createSchema.parse(input);
  await prisma.factoryItem.create({
    data: {
      empresaId: ctx.empresaId,
      product: data.product,
      obra: data.obra,
      nave: data.nave,
      code: data.code,
      status: data.status,
    },
  });
  revalidatePath("/dashboard/fabrica");
}
