"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { Role } from "@/generated/prisma";

const naveSchema = z.object({
  codigo: z.string().min(1).max(20),
  nombre: z.string().min(1).max(100),
});

export async function createNave(
  input: z.infer<typeof naveSchema>,
): Promise<ActionResult<{ id: string }>> {
  return runServerAction(
    "naves.createNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const data = naveSchema.parse(input);
      const nave = await prisma.nave.create({ data });
      revalidatePath("/dashboard/admin/naves");
      return { id: nave.id };
    },
    (result) => ({
      summary: `Crear nave ${input.codigo}`,
      entityType: "Nave",
      entityId: result.id,
      metadata: input,
    }),
  );
}

const updateNaveSchema = naveSchema.extend({ naveId: z.string().min(1) });

export async function updateNave(
  input: z.infer<typeof updateNaveSchema>,
): Promise<ActionResult<void>> {
  return runServerAction(
    "naves.updateNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      const { naveId, ...data } = updateNaveSchema.parse(input);
      await prisma.nave.update({ where: { id: naveId }, data });
      revalidatePath("/dashboard/admin/naves");
    },
    {
      summary: `Actualizar nave ${input.codigo}`,
      entityType: "Nave",
      entityId: input.naveId,
      metadata: input,
    },
  );
}

export async function toggleNaveActive(
  naveId: string,
  isActive: boolean,
): Promise<ActionResult<void>> {
  return runServerAction(
    "naves.toggleNaveActive",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN]);
      await prisma.nave.update({ where: { id: naveId }, data: { isActive } });
      revalidatePath("/dashboard/admin/naves");
    },
    {
      summary: isActive ? "Activar nave" : "Desactivar nave",
      entityType: "Nave",
      entityId: naveId,
      metadata: { isActive },
    },
  );
}

export async function assignLampToNave(
  lampId: string,
  naveId: string,
): Promise<ActionResult<void>> {
  return runServerAction(
    "naves.assignLampToNave",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      await prisma.lamp.findFirstOrThrow({ where: { id: lampId } });
      await prisma.task.updateMany({ where: { lampId }, data: { naveId } });
      revalidatePath("/dashboard/proyectos");
    },
    {
      summary: "Asignar lámpara a nave",
      entityType: "Lamp",
      entityId: lampId,
      metadata: { naveId },
    },
  );
}
