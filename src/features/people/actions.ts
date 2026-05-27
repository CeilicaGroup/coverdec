"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";
import { replacePersonNaves } from "@/features/people/person-naves";

const log = childLogger({ module: "people.actions" });

const absenceSchema = z
  .object({
    personId: z.string().min(1),
    date: z.string().min(8),
    hours: z.number().min(0).max(24).optional(),
    reason: z.string().optional(),
    blockStartMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
    blockEndMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  })
  .superRefine((data, ctx) => {
    const bs = data.blockStartMinutes;
    const be = data.blockEndMinutes;
    if (bs != null && be != null && be <= bs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La franja debe terminar después del inicio",
        path: ["blockEndMinutes"],
      });
    }
  });

function isoWeekdayForSchedule(d: Date): number {
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return 5;
  return wd;
}

export async function setAbsence(input: z.infer<typeof absenceSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = absenceSchema.parse(input);
  const date = new Date(data.date);
  date.setUTCHours(0, 0, 0, 0);

  const hasBlock =
    data.blockStartMinutes != null &&
    data.blockEndMinutes != null &&
    data.blockEndMinutes > data.blockStartMinutes;

  const rawHours = data.hours ?? 0;

  if (rawHours <= 0 && !hasBlock) {
    await prisma.absence.deleteMany({ where: { personId: data.personId, date } });
    revalidatePath("/dashboard/personal");
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/semana");
    revalidatePath("/dashboard/persona");
    revalidatePath("/dashboard/disponibilidad");
    return;
  }

  let hours = rawHours > 0 ? rawHours : 8;
  let blockStart: number | null = null;
  let blockEnd: number | null = null;

  if (hasBlock) {
    blockStart = data.blockStartMinutes!;
    blockEnd = data.blockEndMinutes!;
    const person = await prisma.person.findUnique({
      where: { id: data.personId },
      include: { workWindows: true },
    });
    if (!person) throw new Error("Persona no encontrada");

    const { getWindowsForDate } = await import(
      "@/features/planning/engine/slots/person-schedule"
    );
    const { minutesBlockedInWindows } = await import("@/features/people/absence-overlap");

    const byDay = new Map<number, { startMinutes: number; endMinutes: number }[]>();
    for (const w of person.workWindows) {
      const list = byDay.get(w.dayOfWeek) ?? [];
      list.push({ startMinutes: w.startMinutes, endMinutes: w.endMinutes });
      byDay.set(w.dayOfWeek, list);
    }
    const weekly = [...byDay.entries()].map(([dayOfWeek, windows]) => ({
      dayOfWeek,
      windows: windows.sort((a, b) => a.startMinutes - b.startMinutes),
    }));

    const dow = isoWeekdayForSchedule(date);
    const windows = getWindowsForDate(dow, weekly, undefined);
    const lostMin = minutesBlockedInWindows(windows, blockStart, blockEnd);
    if (lostMin <= 0) {
      throw new Error("La franja no intersecta con el horario laboral de ese día");
    }
    hours = Math.round((lostMin / 60) * 100) / 100;
  }

  await prisma.absence.upsert({
    where: { personId_date: { personId: data.personId, date } },
    update: {
      hours,
      reason: data.reason?.trim() ? data.reason.trim() : null,
      blockStartMinutes: blockStart,
      blockEndMinutes: blockEnd,
    },
    create: {
      personId: data.personId,
      date,
      hours,
      reason: data.reason?.trim() ? data.reason.trim() : null,
      blockStartMinutes: blockStart,
      blockEndMinutes: blockEnd,
    },
  });
  revalidatePath("/dashboard/personal");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/disponibilidad");
}

const specialtySchema = z.object({
  process: z.string().min(1),
  mode: z.enum(["responsable", "apoyo", "otra"]),
});

const savePersonSchema = z
  .object({
    id: z.string().min(1).optional(),
    alias: z.string().optional(),
    iniciales: z.string().min(1).max(12),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    hourlyRate: z.number().min(0).default(14.75),
    overtimeHourlyRate: z.number().min(0).default(22.13),
    notes: z.string().optional(),
    isActive: z.boolean().default(true),
    naveIds: z.array(z.string().min(1)).min(1),
    userId: z.string().min(1),
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
            iniciales,
            alias: data.alias?.trim() ? data.alias.trim() : null,
            color: data.color,
            hourlyRate: data.hourlyRate,
            overtimeHourlyRate: data.overtimeHourlyRate,
            notes: data.notes?.trim() ? data.notes.trim() : null,
            isActive: data.isActive,
          },
        });
        personId = data.id;
      } else {
        const created = await tx.person.create({
          data: {
            iniciales,
            alias: data.alias?.trim() ? data.alias.trim() : null,
            color: data.color,
            hourlyRate: data.hourlyRate,
            overtimeHourlyRate: data.overtimeHourlyRate,
            notes: data.notes?.trim() ? data.notes.trim() : null,
            isActive: data.isActive,
          },
        });
        personId = created.id;
      }
      await replacePersonNaves(personId, data.naveIds, tx);
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
      // Unlink any user currently pointing to this person, then link the chosen user.
      await tx.user.updateMany({ where: { personId }, data: { personId: null } });
      await tx.user.update({ where: { id: data.userId }, data: { personId } });
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

const workWindowSchema = z.object({
  dayOfWeek: z.number().int().min(1).max(5),
  startMinutes: z.number().int().min(0).max(24 * 60),
  endMinutes: z.number().int().min(0).max(24 * 60),
});

const saveWorkWindowsSchema = z.object({
  personId: z.string().min(1),
  windows: z.array(workWindowSchema),
});

export async function savePersonWorkWindows(
  input: z.infer<typeof saveWorkWindowsSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = saveWorkWindowsSchema.parse(input);

  for (const w of data.windows) {
    if (w.endMinutes <= w.startMinutes) {
      throw new Error("Cada franja debe tener fin posterior al inicio.");
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.personWorkWindow.deleteMany({ where: { personId: data.personId } });
    if (data.windows.length > 0) {
      await tx.personWorkWindow.createMany({
        data: data.windows.map((w) => ({
          personId: data.personId,
          dayOfWeek: w.dayOfWeek,
          startMinutes: w.startMinutes,
          endMinutes: w.endMinutes,
        })),
      });
    }
  });

  revalidatePath("/dashboard/personal");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/disponibilidad");
}

export async function linkPersonToUser(
  personId: string,
  userId: string | null,
): Promise<void> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  if (userId === null) {
    await prisma.user.updateMany({
      where: { personId },
      data: { personId: null },
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { personId }, data: { personId: null } });
      await tx.user.update({ where: { id: userId }, data: { personId } });
    });
  }

  log.info({ personId, userId }, "person-user link updated");
  revalidatePath("/dashboard/personal");
}
