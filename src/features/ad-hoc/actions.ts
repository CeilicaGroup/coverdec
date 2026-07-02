"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import { Role } from "@/generated/prisma";
import { assertSingleNaveId } from "@/features/people/person-naves";
import { createAdHocTaskAndAssign } from "./create-ad-hoc-task";

const log = childLogger({ module: "ad-hoc.actions" });

const createAdHocTaskSchema = z.object({
  personId: z.string().min(1),
  notes: z.string().min(1).max(500),
});

export async function createAdHocTask(
  input: z.infer<typeof createAdHocTaskSchema>,
) {
  return runAuditedMutation(
    "ad-hoc.createAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createAdHocTaskSchema.parse(input);

      const person = await prisma.person.findFirst({
        where: { id: data.personId, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (!person) throw new Error("Persona no encontrada.");

      const naveId = assertSingleNaveId(
        person.personNaves.map((row) => row.naveId),
      );

      const result = await prisma.$transaction((tx) =>
        createAdHocTaskAndAssign(tx, {
          personId: data.personId,
          naveId,
          notes: data.notes,
          createdByUserId: ctx.userId,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personId: data.personId,
          naveId,
        },
        "ad-hoc task created",
      );

      revalidatePath("/dashboard/semana");
      return result;
    },
    (result) => ({
      summary: "Crear tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
}

export async function listAdHocFormOptions() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const people = await prisma.person.findMany({
    where: { isActive: true },
    select: {
      id: true,
      iniciales: true,
      alias: true,
      personNaves: {
        select: {
          nave: { select: { codigo: true } },
        },
      },
    },
    orderBy: { iniciales: "asc" },
  });

  return {
    people: people.map((person) => {
      const naveCodigo = person.personNaves[0]?.nave.codigo;
      const name = person.alias ?? person.iniciales;
      return {
        id: person.id,
        label: naveCodigo ? `${name} · ${naveCodigo}` : name,
      };
    }),
  };
}
