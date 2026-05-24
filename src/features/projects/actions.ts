"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import {Role } from "@/generated/prisma";
import {
  adjustPendingOnEstimateChange,
  buildTasksFromFrame,
  getNextTaskOrder,
} from "@/features/projects/lamp-tasks";

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

const updateProjectSchema = projectSchema.extend({
  projectId: z.string().min(1),
});

export async function updateProject(input: z.infer<typeof updateProjectSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateProjectSchema.parse(input);

  await prisma.project.findFirstOrThrow({
    where: { id: data.projectId, empresaId: ctx.empresaId },
  });

  await prisma.project.update({
    where: { id: data.projectId },
    data: {
      name: data.name,
      client: data.client || null,
      obra: data.obra || null,
      deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
      priority: data.priority,
      isBillable: data.isBillable,
      notes: data.notes?.trim() ? data.notes.trim() : null,
    },
  });

  log.info({ id: data.projectId }, "project updated");
  revalidatePath("/dashboard/proyectos");
  revalidatePath(`/dashboard/proyectos/${data.projectId}`);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/proyecto");
  return { id: data.projectId };
}

const lampSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  frameTypeId: z.string().min(1),
  surfaceM2: z.number().positive(),
  units: z.number().int().positive().default(1),
});

export async function createLamp(input: z.infer<typeof lampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = lampSchema.parse(input);

  await prisma.project.findFirstOrThrow({
    where: { id: data.projectId, empresaId: ctx.empresaId },
  });

  const blueprints = await buildTasksFromFrame(data.frameTypeId, data.surfaceM2);
  if (blueprints.length === 0) {
    throw new Error(
      "El bastidor seleccionado no tiene procesos con horas para esta medida.",
    );
  }

  const lamp = await prisma.$transaction(async (tx) => {
    const created = await tx.lamp.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        frameTypeId: data.frameTypeId,
        surfaceM2: data.surfaceM2,
        units: data.units,
      },
    });

    await tx.task.createMany({
      data: blueprints.map((bp) => ({
        projectId: data.projectId,
        lampId: created.id,
        process: bp.process,
        estimatedHours: bp.estimatedHours,
        pendingHours: bp.estimatedHours,
        order: bp.order,
      })),
    });

    return created;
  });

  log.info({ lampId: lamp.id }, "lamp created with tasks");
  revalidatePath("/dashboard/proyectos");
  return { id: lamp.id };
}

const updateTaskHoursSchema = z.object({
  taskId: z.string().min(1),
  estimatedHours: z.number().positive(),
});

export async function updateTaskHours(input: z.infer<typeof updateTaskHoursSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateTaskHoursSchema.parse(input);

  const task = await prisma.task.findFirst({
    where: {
      id: data.taskId,
      project: { empresaId: ctx.empresaId },
    },
  });
  if (!task) throw new Error("Tarea no encontrada");

  const pendingHours = adjustPendingOnEstimateChange(
    data.estimatedHours,
    task.doneHours,
    task.pendingHours,
  );

  await prisma.task.update({
    where: { id: task.id },
    data: { estimatedHours: data.estimatedHours, pendingHours },
  });

  revalidatePath("/dashboard/proyectos");
}

const addExtraTaskSchema = z.object({
  lampId: z.string().min(1),
  process: z.string().min(1),
  estimatedHours: z.number().positive(),
});

export async function addExtraTask(input: z.infer<typeof addExtraTaskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = addExtraTaskSchema.parse(input);

  const lamp = await prisma.lamp.findFirst({
    where: { id: data.lampId, project: { empresaId: ctx.empresaId } },
    include: { tasks: { select: { process: true } } },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  if (lamp.tasks.some((t) => t.process === data.process)) {
    throw new Error("Ese proceso ya existe en esta lámpara.");
  }

  await prisma.$transaction(async (tx) => {
    const order = await getNextTaskOrder(tx, lamp.id);
    await tx.task.create({
      data: {
        projectId: lamp.projectId,
        lampId: lamp.id,
        process: data.process,
        estimatedHours: data.estimatedHours,
        pendingHours: data.estimatedHours,
        order,
      },
    });
  });

  revalidatePath("/dashboard/proyectos");
}

const deleteTaskSchema = z.object({ taskId: z.string().min(1) });

export async function deleteTask(input: z.infer<typeof deleteTaskSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteTaskSchema.parse(input);

  const task = await prisma.task.findFirst({
    where: {
      id: data.taskId,
      project: { empresaId: ctx.empresaId },
    },
    include: { _count: { select: { assignments: true, timeEntries: true } } },
  });
  if (!task) throw new Error("Tarea no encontrada");

  if (task.doneHours > 0) {
    throw new Error("No se puede eliminar: la tarea tiene horas registradas.");
  }
  if (task._count.assignments > 0 || task._count.timeEntries > 0) {
    throw new Error(
      "No se puede eliminar: hay asignaciones de planning o partes de trabajo.",
    );
  }

  await prisma.task.delete({ where: { id: task.id } });
  revalidatePath("/dashboard/proyectos");
}

const updateTaskNotesSchema = z.object({
  taskId: z.string().min(1),
  notes: z.string().max(500).nullable(),
});

export async function updateTaskNotes(input: z.infer<typeof updateTaskNotesSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateTaskNotesSchema.parse(input);

  const task = await prisma.task.findFirst({
    where: {
      id: data.taskId,
      project: { empresaId: ctx.empresaId },
    },
  });
  if (!task) throw new Error("Tarea no encontrada");

  await prisma.task.update({
    where: { id: task.id },
    data: { notes: data.notes?.trim() ? data.notes.trim() : null },
  });

  revalidatePath("/dashboard/proyectos");
}

const deleteLampSchema = z.object({ lampId: z.string().min(1) });

export async function deleteLamp(input: z.infer<typeof deleteLampSchema>) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteLampSchema.parse(input);

  const lamp = await prisma.lamp.findFirst({
    where: { id: data.lampId, project: { empresaId: ctx.empresaId } },
    include: {
      tasks: {
        include: {
          _count: { select: { assignments: true, timeEntries: true } },
        },
      },
    },
  });
  if (!lamp) throw new Error("Lámpara no encontrada");

  const hasWork = lamp.tasks.some(
    (t) =>
      t.doneHours > 0 ||
      t._count.assignments > 0 ||
      t._count.timeEntries > 0,
  );
  if (hasWork) {
    throw new Error(
      "No se puede eliminar: hay horas o referencias en las tareas de esta lámpara.",
    );
  }

  await prisma.lamp.delete({ where: { id: lamp.id } });
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
