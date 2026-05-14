"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { ProcessCode, Role } from "@/generated/prisma";

const processRowSchema = z.object({
  process: z.nativeEnum(ProcessCode),
  hoursPerUnit: z.number().nonnegative(),
  fixedHours: z.number().nonnegative().default(0),
});

const frameUpsertSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    isActive: z.boolean().default(true),
    processes: z.array(processRowSchema).default([]),
  })
  .superRefine((data, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < data.processes.length; i++) {
      const p = data.processes[i];
      if (seen.has(p.process)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Proceso duplicado",
          path: ["processes", i, "process"],
        });
        return;
      }
      seen.add(p.process);
    }
  });

export async function upsertFrameType(input: z.infer<typeof frameUpsertSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = frameUpsertSchema.parse(input);

  const frame = await prisma.frameType.upsert({
    where: { code: data.code },
    update: {
      name: data.name,
      description: data.description ?? null,
      isActive: data.isActive,
    },
    create: {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      isActive: data.isActive,
    },
  });

  for (const p of data.processes) {
    await prisma.frameTypeProcess.upsert({
      where: {
        frameTypeId_process: { frameTypeId: frame.id, process: p.process },
      },
      update: { hoursPerUnit: p.hoursPerUnit, fixedHours: p.fixedHours },
      create: {
        frameTypeId: frame.id,
        process: p.process,
        hoursPerUnit: p.hoursPerUnit,
        fixedHours: p.fixedHours,
      },
    });
  }

  const keep = data.processes.map((p) => p.process);
  if (keep.length > 0) {
    await prisma.frameTypeProcess.deleteMany({
      where: { frameTypeId: frame.id, process: { notIn: keep } },
    });
  } else {
    await prisma.frameTypeProcess.deleteMany({ where: { frameTypeId: frame.id } });
  }

  revalidatePath("/dashboard/catalogo");
  return frame;
}

const setActiveSchema = z.object({
  frameTypeId: z.string().min(1),
  isActive: z.boolean(),
});

export async function setFrameTypeActive(input: z.infer<typeof setActiveSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = setActiveSchema.parse(input);
  await prisma.frameType.update({
    where: { id: data.frameTypeId },
    data: { isActive: data.isActive },
  });
  revalidatePath("/dashboard/catalogo");
}

const deleteFrameSchema = z.object({ frameTypeId: z.string().min(1) });

export async function deleteFrameType(input: z.infer<typeof deleteFrameSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { frameTypeId } = deleteFrameSchema.parse(input);

  const lamps = await prisma.lamp.count({ where: { frameTypeId } });
  if (lamps > 0) {
    throw new Error(
      "ARCHIVE_ONLY: Hay lámparas que usan este bastidor. Solo se puede archivar.",
    );
  }

  await prisma.$transaction([
    prisma.frameTypeProcess.deleteMany({ where: { frameTypeId } }),
    prisma.frameType.delete({ where: { id: frameTypeId } }),
  ]);
  revalidatePath("/dashboard/catalogo");
}
