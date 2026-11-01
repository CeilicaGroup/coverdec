"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";
import { isSaturdayIso } from "./saturday";

const log = childLogger({ module: "planning.saturday-actions" });

const schema = z
  .object({
    dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** Vacío = ese sábado no se trabaja. */
    personIds: z.array(z.string().min(1)),
    startMinutes: z.number().int().min(0).max(24 * 60),
    endMinutes: z.number().int().min(0).max(24 * 60),
  })
  .refine((d) => isSaturdayIso(d.dateIso), { message: "La fecha debe ser un sábado." })
  .refine((d) => d.endMinutes > d.startMinutes, {
    message: "La hora de fin debe ser posterior a la de inicio.",
  });

/**
 * Habilita (o quita) un sábado laborable para las personas elegidas, con el
 * mismo horario para todas. Quien no esté en la lista deja de trabajar ese
 * sábado. Hay que regenerar el planning de la semana para que cuente.
 */
export async function setSaturdayWork(
  input: z.infer<typeof schema>,
): Promise<ActionResult<void>> {
  return runServerAction(
    "planning.setSaturdayWork",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = schema.parse(input);
      const personIds = [...new Set(data.personIds)];
      const date = new Date(`${data.dateIso}T00:00:00.000Z`);

      const active = await prisma.person.count({ where: { id: { in: personIds }, isActive: true } });
      if (active !== personIds.length) {
        throw new Error("Alguna persona seleccionada no existe o está inactiva.");
      }

      await prisma.$transaction(async (tx) => {
        // Las franjas cuelgan del override (onDelete: Cascade).
        await tx.personScheduleOverride.deleteMany({ where: { date } });
        for (const personId of personIds) {
          await tx.personScheduleOverride.create({
            data: {
              personId,
              date,
              windows: { create: { startMinutes: data.startMinutes, endMinutes: data.endMinutes } },
            },
          });
        }
      });

      log.info({ dateIso: data.dateIso, personIds }, "saturday work set");
      revalidatePath("/dashboard");
      revalidatePath("/dashboard/semana");
      revalidatePath("/dashboard/disponibilidad");
    },
    () => ({
      summary: input.personIds.length > 0 ? "Habilitar sábado laborable" : "Quitar sábado laborable",
      entityType: "PersonScheduleOverride",
      entityId: input.dateIso,
      metadata: { personIds: input.personIds },
    }),
  );
}
