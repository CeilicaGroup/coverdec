"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { ProcessCode, Role } from "@/generated/prisma";

const log = childLogger({ module: "projects.actions" });

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase()
    .slice(0, 80);
}

const projectSchema = z.object({
  name: z.string().min(1).max(120),
  client: z.string().optional(),
  obra: z.string().optional(),
  deliveryDate: z.string().optional(),
  priority: z.number().min(0).max(100).default(50),
  isBillable: z.boolean().default(true),
  notes: z.string().optional(),
});

export async function createProject(input: z.infer<typeof projectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = projectSchema.parse(input);
  const baseCode = slug(data.name) || `proj-${Date.now()}`;
  let code = baseCode;
  let suffix = 1;
  while (
    await prisma.project.findUnique({
      where: { empresaId_code: { empresaId: ctx.empresaId, code } },
    })
  ) {
    suffix += 1;
    code = `${baseCode}-${suffix}`;
  }
  const project = await prisma.project.create({
    data: {
      empresaId: ctx.empresaId,
      code,
      name: data.name,
      client: data.client,
      obra: data.obra,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : undefined,
      priority: data.priority,
      isBillable: data.isBillable,
      notes: data.notes,
    },
  });
  log.info({ id: project.id }, "project created");
  revalidatePath("/dashboard/proyectos");
  return { id: project.id };
}

const lampSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  frameTypeId: z.string().optional(),
  surfaceM2: z.number().positive().optional(),
  units: z.number().int().positive().default(1),
});

export async function createLamp(input: z.infer<typeof lampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = lampSchema.parse(input);
  await prisma.project.findFirstOrThrow({
    where: { id: data.projectId, empresaId: ctx.empresaId },
  });

  const lamp = await prisma.lamp.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      frameTypeId: data.frameTypeId,
      surfaceM2: data.surfaceM2,
      units: data.units,
    },
  });

  if (data.frameTypeId && data.surfaceM2) {
    const frameProcesses = await prisma.frameTypeProcess.findMany({
      where: { frameTypeId: data.frameTypeId },
    });
    for (const fp of frameProcesses) {
      const hours = fp.hoursPerUnit * data.surfaceM2 + fp.fixedHours;
      if (hours <= 0) continue;
      await prisma.task.create({
        data: {
          projectId: data.projectId,
          lampId: lamp.id,
          process: fp.process,
          estimatedHours: hours,
          pendingHours: hours,
        },
      });
    }
  }

  revalidatePath("/dashboard/proyectos");
  return { id: lamp.id };
}

const taskSchema = z.object({
  projectId: z.string().min(1),
  lampId: z.string().optional(),
  process: z.nativeEnum(ProcessCode),
  estimatedHours: z.number().positive(),
});

export async function createTask(input: z.infer<typeof taskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = taskSchema.parse(input);
  await prisma.project.findFirstOrThrow({
    where: { id: data.projectId, empresaId: ctx.empresaId },
  });
  await prisma.task.create({
    data: {
      projectId: data.projectId,
      lampId: data.lampId,
      process: data.process,
      estimatedHours: data.estimatedHours,
      pendingHours: data.estimatedHours,
    },
  });
  revalidatePath("/dashboard/proyectos");
}

const toggleSchema = z.object({ projectId: z.string().min(1), isActive: z.boolean() });

export async function toggleProjectActive(input: z.infer<typeof toggleSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = toggleSchema.parse(input);
  await prisma.project.update({
    where: { id: data.projectId },
    data: { isActive: data.isActive },
  });
  revalidatePath("/dashboard/proyectos");
}

const deleteProjectSchema = z.object({ projectId: z.string().min(1) });

export async function deleteProject(input: z.infer<typeof deleteProjectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { projectId } = deleteProjectSchema.parse(input);

  await prisma.project.findFirstOrThrow({
    where: { id: projectId, empresaId: ctx.empresaId },
  });

  const [timeEntries, orders] = await Promise.all([
    prisma.timeEntry.count({ where: { projectId } }),
    prisma.productionOrder.count({ where: { projectId } }),
  ]);

  if (timeEntries > 0 || orders > 0) {
    throw new Error(
      "ARCHIVE_ONLY: Hay partes de trabajo u órdenes de producción vinculadas. Solo se puede archivar el proyecto (desactivar).",
    );
  }

  await prisma.project.delete({ where: { id: projectId } });
  log.info({ projectId }, "project deleted");
  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/proyecto");
}
