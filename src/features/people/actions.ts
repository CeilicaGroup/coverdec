"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { ProcessCode, Role } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";

const log = childLogger({ module: "people.actions" });

const absenceSchema = z.object({
  personId: z.string().min(1),
  date: z.string().min(8),
  hours: z.number().min(0).max(24).default(8),
  reason: z.string().optional(),
});

export async function setAbsence(input: z.infer<typeof absenceSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = absenceSchema.parse(input);
  const date = new Date(data.date);
  date.setUTCHours(0, 0, 0, 0);

  if (data.hours <= 0) {
    await prisma.absence.deleteMany({ where: { personId: data.personId, date } });
  } else {
    await prisma.absence.upsert({
      where: { personId_date: { personId: data.personId, date } },
      update: { hours: data.hours, reason: data.reason },
      create: {
        personId: data.personId,
        date,
        hours: data.hours,
        reason: data.reason,
      },
    });
  }
  revalidatePath("/dashboard/personal");
}

const specialtySchema = z.object({
  process: z.nativeEnum(ProcessCode),
  mode: z.enum(["responsable", "apoyo", "otra"]),
});

const savePersonSchema = z
  .object({
    id: z.string().min(1).optional(),
    nombre: z.string().min(1),
    iniciales: z.string().min(1).max(12),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    capacityHours: z.number().min(1).max(24).default(8),
    notes: z.string().optional(),
    isActive: z.boolean().default(true),
    specialties: z.array(specialtySchema).default([]),
  })
  .superRefine((data, ctx) => {
    const keys = data.specialties.map((s) => s.process);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Proceso duplicado en especialidades",
        path: ["specialties"],
      });
    }
  });

export async function savePerson(input: z.infer<typeof savePersonSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = savePersonSchema.parse(input);
  const iniciales = data.iniciales.trim().toUpperCase();

  const specialtyRows = data.specialties.map((s) => ({
    process: s.process,
    isPrimary: s.mode === "responsable",
    isFallback: s.mode === "apoyo",
  }));

  try {
    await prisma.$transaction(async (tx) => {
      let personId: string;
      if (data.id) {
        await tx.person.update({
          where: { id: data.id },
          data: {
            nombre: data.nombre.trim(),
            iniciales,
            color: data.color,
            capacityHours: data.capacityHours,
            notes: data.notes?.trim() ? data.notes.trim() : null,
            isActive: data.isActive,
          },
        });
        personId = data.id;
      } else {
        const created = await tx.person.create({
          data: {
            nombre: data.nombre.trim(),
            iniciales,
            color: data.color,
            capacityHours: data.capacityHours,
            notes: data.notes?.trim() ? data.notes.trim() : null,
            isActive: data.isActive,
          },
        });
        personId = created.id;
      }
      await tx.personSpecialty.deleteMany({ where: { personId } });
      if (specialtyRows.length > 0) {
        await tx.personSpecialty.createMany({
          data: specialtyRows.map((s) => ({
            personId,
            process: s.process,
            isPrimary: s.isPrimary,
            isFallback: s.isFallback,
          })),
        });
      }
    });
  } catch (e: unknown) {
    log.error(
      { err: e, op: "savePerson", personId: data.id ?? null },
      "save person failed",
    );
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      e.code === "P2002"
    ) {
      throw new Error("Las iniciales ya están en uso");
    }
    throw e;
  }

  revalidatePath("/dashboard/personal");
}

const deletePersonSchema = z.object({ personId: z.string().min(1) });

export async function deletePerson(input: z.infer<typeof deletePersonSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { personId } = deletePersonSchema.parse(input);

  const [assignments, linkedUser] = await Promise.all([
    prisma.planningAssignment.count({ where: { personId } }),
    prisma.user.count({ where: { personId } }),
  ]);

  if (assignments > 0 || linkedUser > 0) {
    throw new Error(
      "ARCHIVE_ONLY: Hay planning histórico o un usuario vinculado. Solo se puede desactivar la persona.",
    );
  }

  await prisma.person.delete({ where: { id: personId } });
  log.info({ personId }, "person deleted");
  revalidatePath("/dashboard/personal");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
}
