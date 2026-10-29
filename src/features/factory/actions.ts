"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { childLogger } from "@/lib/logger";
import { FactoryStatus, Role, type FactoryItem } from "@/generated/prisma";

const log = childLogger({ module: "factory.actions" });

/**
 * La fecha de envío existe solo mientras el ítem está ENVIADO: se fija al entrar
 * (sin moverla si ya lo estaba) y se borra al salir. Sin cambio de estado, se conserva.
 */
function nextShippedAt(
  item: { status: FactoryStatus; shippedAt: Date | null },
  status: FactoryStatus | undefined,
): Date | null {
  if (status === undefined) return item.shippedAt;
  if (status !== FactoryStatus.ENVIADO) return null;
  return item.status === FactoryStatus.ENVIADO && item.shippedAt ? item.shippedAt : new Date();
}

const updateSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(FactoryStatus).optional(),
  nave: z.string().optional(),
  notes: z.string().optional(),
  scheduledAt: z.string().optional(),
});

export async function updateFactoryItem(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult<void>> {
  return runServerAction(
    "factory.updateFactoryItem",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = updateSchema.parse(input);
      const item = await prisma.factoryItem.findFirstOrThrow({
        where: { id: data.id },
      });
      await prisma.factoryItem.update({
        where: { id: item.id },
        data: {
          status: data.status,
          nave: data.nave,
          notes: data.notes,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
          shippedAt: nextShippedAt(item, data.status),
        },
      });
      log.info({ id: item.id, status: data.status }, "factory item updated");
      revalidatePath("/dashboard/fabrica");
    },
    {
      summary: "Actualizar ítem de fábrica",
      entityType: "FactoryItem",
      entityId: input.id,
      metadata: input,
    },
  );
}

const createSchema = z.object({
  product: z.string().min(1),
  obra: z.string().optional(),
  nave: z.string().optional(),
  code: z.string().optional(),
  status: z.nativeEnum(FactoryStatus).default(FactoryStatus.DOSSIER),
});

export async function createFactoryItem(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<FactoryItem>> {
  return runServerAction(
    "factory.createFactoryItem",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createSchema.parse(input);
      const item = await prisma.factoryItem.create({
        data: {
          product: data.product,
          obra: data.obra,
          nave: data.nave,
          code: data.code,
          status: data.status,
          shippedAt: data.status === FactoryStatus.ENVIADO ? new Date() : null,
        },
      });
      revalidatePath("/dashboard/fabrica");
      return item;
    },
    (result) => ({
      summary: `Crear ítem de fábrica: ${input.product}`,
      entityType: "FactoryItem",
      entityId: result.id,
      metadata: input,
    }),
  );
}
