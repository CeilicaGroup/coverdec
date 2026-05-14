"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { ProcessCode, TimeEntrySource } from "@/generated/prisma";

const log = childLogger({ module: "time-tracking.actions" });

const startSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  process: z.nativeEnum(ProcessCode).optional(),
  notes: z.string().max(500).optional(),
});

export async function startTimer(input: z.infer<typeof startSchema>) {
  const ctx = await requireDashboardContext();
  const data = startSchema.parse(input);
  const open = await prisma.timeEntry.findFirst({
    where: { userId: ctx.userId, endedAt: null },
  });
  if (open) {
    throw new Error("Ya tienes un timer activo. Detenlo primero.");
  }
  await prisma.timeEntry.create({
    data: {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      projectId: data.projectId,
      lampId: data.lampId,
      taskId: data.taskId,
      process: data.process,
      source: TimeEntrySource.TIMER,
      startedAt: new Date(),
      notes: data.notes,
    },
  });
  log.info({ userId: ctx.userId, projectId: data.projectId }, "timer started");
  revalidatePath("/dashboard/horas");
}

const stopSchema = z.object({ entryId: z.string().min(1) });

export async function stopTimer(input: z.infer<typeof stopSchema>) {
  const ctx = await requireDashboardContext();
  const data = stopSchema.parse(input);
  const entry = await prisma.timeEntry.findFirst({
    where: { id: data.entryId, userId: ctx.userId, endedAt: null },
  });
  if (!entry) throw new Error("Timer no encontrado");
  const endedAt = new Date();
  const hours = (endedAt.getTime() - entry.startedAt.getTime()) / 3600000;
  await prisma.timeEntry.update({
    where: { id: entry.id },
    data: { endedAt, hours },
  });
  log.info({ entryId: entry.id, hours }, "timer stopped");
  revalidatePath("/dashboard/horas");
}

const manualSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  process: z.nativeEnum(ProcessCode).optional(),
  startedAt: z.string().min(8),
  hours: z.number().positive().max(24),
  notes: z.string().max(500).optional(),
});

export async function createManualEntry(input: z.infer<typeof manualSchema>) {
  const ctx = await requireDashboardContext();
  const data = manualSchema.parse(input);
  const startedAt = new Date(data.startedAt);
  const endedAt = new Date(startedAt.getTime() + data.hours * 3600000);
  await prisma.timeEntry.create({
    data: {
      empresaId: ctx.empresaId,
      userId: ctx.userId,
      projectId: data.projectId,
      lampId: data.lampId,
      taskId: data.taskId,
      process: data.process,
      source: TimeEntrySource.MANUAL,
      startedAt,
      endedAt,
      hours: data.hours,
      notes: data.notes,
    },
  });
  revalidatePath("/dashboard/horas");
}

const deleteSchema = z.object({ entryId: z.string().min(1) });

export async function deleteEntry(input: z.infer<typeof deleteSchema>) {
  const ctx = await requireDashboardContext();
  const data = deleteSchema.parse(input);
  await prisma.timeEntry.deleteMany({
    where: { id: data.entryId, userId: ctx.userId },
  });
  revalidatePath("/dashboard/horas");
}
