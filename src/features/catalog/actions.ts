"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PROCESS_CODE_PATTERN } from "@/types/process";

const processRowSchema = z.object({
  process: z.string().min(1),
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

  const codes = [...new Set(data.processes.map((p) => p.process))];
  if (codes.length > 0) {
    const found = await prisma.processDefinition.findMany({
      where: { code: { in: codes } },
      select: { code: true },
    });
    const ok = new Set(found.map((f) => f.code));
    const missing = codes.filter((c) => !ok.has(c));
    if (missing.length > 0) {
      throw new Error(`Procesos no definidos en catálogo: ${missing.join(", ")}`);
    }
  }

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

  for (let i = 0; i < data.processes.length; i++) {
    const p = data.processes[i];
    await prisma.frameTypeProcess.upsert({
      where: {
        frameTypeId_process: { frameTypeId: frame.id, process: p.process },
      },
      update: {
        sequence: i,
        hoursPerUnit: p.hoursPerUnit,
        fixedHours: p.fixedHours,
      },
      create: {
        frameTypeId: frame.id,
        process: p.process,
        sequence: i,
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

const updateProcessSchema = z.object({
  code: z.string().min(1),
  waitHours: z.number().min(0).max(168),
  label: z.string().min(1).max(120),
  bgColor: z.string().min(1),
  fgColor: z.string().min(1),
  borderColor: z.string().min(1),
  canFragment: z.boolean().default(true),
});

export async function updateProcessDefinition(
  input: z.infer<typeof updateProcessSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateProcessSchema.parse(input);

  await prisma.processDefinition.update({
    where: { code: data.code },
    data: {
      waitHours: data.waitHours,
      label: data.label.trim(),
      bgColor: data.bgColor,
      fgColor: data.fgColor,
      borderColor: data.borderColor,
      canFragment: data.canFragment,
    },
  });

  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
  revalidatePath("/dashboard/gantt");
  revalidatePath("/dashboard/personal");
}

const createProcessSchema = z.object({
  code: z.string().regex(PROCESS_CODE_PATTERN, "Código tipo CNC, PEGADO_ESPEJO"),
  label: z.string().min(1).max(120),
  waitHours: z.number().min(0).max(168),
  factor: z.number().positive().optional(),
  setupHours: z.number().min(0).optional(),
  bgColor: z.string().min(1).optional(),
  fgColor: z.string().min(1).optional(),
  borderColor: z.string().min(1).optional(),
});

export async function createProcessDefinition(
  input: z.infer<typeof createProcessSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = createProcessSchema.parse(input);

  await prisma.processDefinition.create({
    data: {
      code: data.code,
      label: data.label.trim(),
      waitHours: data.waitHours,
      factor: data.factor ?? 1,
      setupHours: data.setupHours ?? 0,
      bgColor: data.bgColor ?? "#F3F4F6",
      fgColor: data.fgColor ?? "#374151",
      borderColor: data.borderColor ?? "#9CA3AF",
    },
  });

  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/personal");
}

const deleteProcessSchema = z.object({
  code: z.string().min(1),
});

export async function deleteProcessDefinition(
  input: z.infer<typeof deleteProcessSchema>,
) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteProcessSchema.parse(input);

  const [tasks, ftp, ps, te, po, pa] = await Promise.all([
    prisma.task.count({ where: { process: data.code } }),
    prisma.frameTypeProcess.count({ where: { process: data.code } }),
    prisma.personSpecialty.count({ where: { process: data.code } }),
    prisma.timeEntry.count({ where: { process: data.code } }),
    prisma.productionOrder.count({ where: { process: data.code } }),
    prisma.planningAssignment.count({ where: { process: data.code } }),
  ]);
  if (tasks + ftp + ps + te + po + pa > 0) {
    throw new Error(
      "No se puede eliminar: el proceso está en uso (tareas, bastidores, planning, horas u órdenes).",
    );
  }

  await prisma.processDefinition.delete({ where: { code: data.code } });

  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/personal");
}
