"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { utcDayStart } from "@/lib/holidays";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function parseUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

const createHolidaySchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
    name: z.string().min(1).max(200),
  })
  .superRefine((data, ctx) => {
    const s = parseUtcDate(data.startDate).getTime();
    const e = parseUtcDate(data.endDate).getTime();
    if (s > e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La fecha fin debe ser igual o posterior al inicio",
        path: ["endDate"],
      });
    }
  });

const updateHolidaySchema = z
  .object({
    id: z.string().min(1),
    startDate: isoDate,
    endDate: isoDate,
    name: z.string().min(1).max(200),
  })
  .superRefine((data, ctx) => {
    const s = parseUtcDate(data.startDate).getTime();
    const e = parseUtcDate(data.endDate).getTime();
    if (s > e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La fecha fin debe ser igual o posterior al inicio",
        path: ["endDate"],
      });
    }
  });

const deleteHolidaySchema = z.object({
  id: z.string().min(1),
});

export async function createHoliday(
  input: z.infer<typeof createHolidaySchema>,
): Promise<ActionResult<void>> {
  return runServerAction("holidays.createHoliday", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = createHolidaySchema.parse(input);
  const startDate = utcDayStart(parseUtcDate(data.startDate));
  const endDate = utcDayStart(parseUtcDate(data.endDate));

  await prisma.holiday.create({
    data: {
      startDate,
      endDate,
      name: data.name.trim(),
    },
  });

  revalidatePath("/dashboard/festivos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/mes");
  revalidatePath("/dashboard/disponibilidad");
  revalidatePath("/dashboard/gantt");
  });
}

export async function updateHoliday(
  input: z.infer<typeof updateHolidaySchema>,
): Promise<ActionResult<void>> {
  return runServerAction("holidays.updateHoliday", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateHolidaySchema.parse(input);
  const startDate = utcDayStart(parseUtcDate(data.startDate));
  const endDate = utcDayStart(parseUtcDate(data.endDate));

  await prisma.holiday.update({
    where: { id: data.id },
    data: {
      startDate,
      endDate,
      name: data.name.trim(),
    },
  });

  revalidatePath("/dashboard/festivos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/mes");
  revalidatePath("/dashboard/disponibilidad");
  revalidatePath("/dashboard/gantt");
  });
}

export async function deleteHoliday(
  input: z.infer<typeof deleteHolidaySchema>,
): Promise<ActionResult<void>> {
  return runServerAction("holidays.deleteHoliday", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteHolidaySchema.parse(input);

  await prisma.holiday.delete({ where: { id: data.id } });

  revalidatePath("/dashboard/festivos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/mes");
  revalidatePath("/dashboard/disponibilidad");
  revalidatePath("/dashboard/gantt");
  });
}
