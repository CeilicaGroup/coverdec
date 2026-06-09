"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";
import { replacePersonNaves } from "@/features/people/person-naves";
import { ABSENCE_REASON_MAX_LENGTH } from "@/features/people/absence-constants";
import {
  FULL_DAY_BLOCK_END,
  FULL_DAY_BLOCK_START,
  absenceOverlapPrismaFilter,
  totalScheduledHoursForAbsence,
} from "@/features/people/absence-model";
import {
  isoWeekdayForSchedule,
  parseUtcDateIso,
} from "@/features/people/absence-schedule";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";

const log = childLogger({ module: "people.actions" });

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const absenceReasonSchema = z
  .string()
  .trim()
  .min(1, "El motivo es obligatorio")
  .max(ABSENCE_REASON_MAX_LENGTH);

const absenceSchema = z
  .object({
    id: z.string().min(1).optional(),
    personId: z.string().min(1),
    date: isoDate,
    endDate: isoDate.optional(),
    mode: z.enum(["block", "day", "range"]),
    reason: absenceReasonSchema,
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
    if (data.mode === "range") {
      if (!data.endDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Indica la fecha fin del rango",
          path: ["endDate"],
        });
        return;
      }
      if (data.endDate < data.date) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "La fecha fin debe ser igual o posterior al inicio",
          path: ["endDate"],
        });
      }
    }
    if (data.mode === "block") {
      const hasBlock =
        data.blockStartMinutes != null &&
        data.blockEndMinutes != null &&
        data.blockEndMinutes > data.blockStartMinutes;
      if (!hasBlock) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Indica una franja horaria válida",
          path: ["blockEndMinutes"],
        });
      }
    }
  });

const deleteAbsenceSchema = z.object({
  id: z.string().min(1).optional(),
  personId: z.string().min(1),
  date: isoDate,
});

function revalidateAbsencePaths() {
  revalidatePath("/dashboard/personal");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/mes");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/disponibilidad");
  revalidatePath("/dashboard/fichaje-diario");
}

async function loadPersonWorkWindows(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    include: { workWindows: true },
  });
  if (!person) throw new Error("Persona no encontrada");
  return person;
}

async function resolveBlockAbsenceHours(
  personId: string,
  date: Date,
  blockStart: number,
  blockEnd: number,
): Promise<number> {
  const person = await loadPersonWorkWindows(personId);
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
  return Math.round((lostMin / 60) * 100) / 100;
}

async function assertNoAbsenceOverlap(args: {
  personId: string;
  startDate: Date;
  endDate: Date;
  excludeId?: string;
}) {
  const overlapping = await prisma.absence.findMany({
    where: {
      personId: args.personId,
      ...absenceOverlapPrismaFilter(args.startDate, args.endDate),
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
    },
    select: { id: true, date: true, endDate: true },
  });
  if (overlapping.length > 0) {
    throw new Error(
      "Ya existe una ausencia que solapa con esas fechas. Edítala o elimínala primero.",
    );
  }
}

export async function deleteAbsence(
  input: z.infer<typeof deleteAbsenceSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("people.deleteAbsence", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteAbsenceSchema.parse(input);
  const date = parseUtcDateIso(data.date);

  if (data.id) {
    await prisma.absence.deleteMany({ where: { id: data.id, personId: data.personId } });
  } else {
    await prisma.absence.deleteMany({ where: { personId: data.personId, date } });
  }

  revalidateAbsencePaths();
  });
}

export async function setAbsence(
  input: z.infer<typeof absenceSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("people.setAbsence", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = absenceSchema.parse(input);
  const reason = data.reason.trim();
  const date = parseUtcDateIso(data.date);

  if (data.mode === "range") {
    const endDate = parseUtcDateIso(data.endDate!);
    if (data.endDate! < data.date) {
      throw new Error("Rango de fechas inválido");
    }
    const dayCount =
      Math.round((endDate.getTime() - date.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (dayCount > 366) {
      throw new Error("El rango no puede superar 366 días");
    }

    const person = await loadPersonWorkWindows(data.personId);
    await assertNoAbsenceOverlap({
      personId: data.personId,
      startDate: date,
      endDate,
      excludeId: data.id,
    });

    const hours = totalScheduledHoursForAbsence(
      {
        date,
        endDate,
        hours: 0,
        blockStartMinutes: FULL_DAY_BLOCK_START,
        blockEndMinutes: FULL_DAY_BLOCK_END,
      },
      person.workWindows,
    );

    if (data.id) {
      await prisma.absence.update({
        where: { id: data.id },
        data: {
          personId: data.personId,
          date,
          endDate,
          hours,
          reason,
          blockStartMinutes: FULL_DAY_BLOCK_START,
          blockEndMinutes: FULL_DAY_BLOCK_END,
        },
      });
    } else {
      await prisma.absence.create({
        data: {
          personId: data.personId,
          date,
          endDate,
          hours,
          reason,
          blockStartMinutes: FULL_DAY_BLOCK_START,
          blockEndMinutes: FULL_DAY_BLOCK_END,
        },
      });
    }

    revalidateAbsencePaths();
    return;
  }

  if (data.mode === "day") {
    const person = await loadPersonWorkWindows(data.personId);
    await assertNoAbsenceOverlap({
      personId: data.personId,
      startDate: date,
      endDate: date,
      excludeId: data.id,
    });

    const hours = totalScheduledHoursForAbsence(
      {
        date,
        endDate: date,
        hours: 0,
        blockStartMinutes: FULL_DAY_BLOCK_START,
        blockEndMinutes: FULL_DAY_BLOCK_END,
      },
      person.workWindows,
    );

    if (data.id) {
      await prisma.absence.update({
        where: { id: data.id },
        data: {
          personId: data.personId,
          date,
          endDate: date,
          hours,
          reason,
          blockStartMinutes: FULL_DAY_BLOCK_START,
          blockEndMinutes: FULL_DAY_BLOCK_END,
        },
      });
    } else {
      await prisma.absence.create({
        data: {
          personId: data.personId,
          date,
          endDate: date,
          hours,
          reason,
          blockStartMinutes: FULL_DAY_BLOCK_START,
          blockEndMinutes: FULL_DAY_BLOCK_END,
        },
      });
    }
    revalidateAbsencePaths();
    return;
  }

  if (data.mode !== "block") {
    throw new Error("Modo de ausencia no válido");
  }

  const blockStart = data.blockStartMinutes!;
  const blockEnd = data.blockEndMinutes!;

  await assertNoAbsenceOverlap({
    personId: data.personId,
    startDate: date,
    endDate: date,
    excludeId: data.id,
  });

  const hours = await resolveBlockAbsenceHours(
    data.personId,
    date,
    blockStart,
    blockEnd,
  );

  if (data.id) {
    await prisma.absence.update({
      where: { id: data.id },
      data: {
        personId: data.personId,
        date,
        endDate: date,
        hours,
        reason,
        blockStartMinutes: blockStart,
        blockEndMinutes: blockEnd,
      },
    });
  } else {
    await prisma.absence.create({
      data: {
        personId: data.personId,
        date,
        endDate: date,
        hours,
        reason,
        blockStartMinutes: blockStart,
        blockEndMinutes: blockEnd,
      },
    });
  }
  revalidateAbsencePaths();
  });
}

const specialtySchema = z.object({
  process: z.string().min(1),
  mode: z.enum(["responsable", "apoyo"]),
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

export async function savePerson(
  input: z.infer<typeof savePersonSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("people.savePerson", async () => {
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
  });
}

const deletePersonSchema = z.object({ personId: z.string().min(1) });

export async function deletePerson(
  input: z.infer<typeof deletePersonSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("people.deletePerson", async () => {
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
  });
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
