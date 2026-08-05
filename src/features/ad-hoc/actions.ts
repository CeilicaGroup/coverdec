"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runServerAction } from "@/lib/server-action";
import type { ActionResult } from "@/lib/action-result";
import { Role, TaskSystemKind } from "@/generated/prisma";
import { createAdHocTaskRecord } from "./create-ad-hoc-task";
import { updateAdHocTaskRecord } from "./update-ad-hoc-task";
import { injectPendingAdHocIntoDraftPlanning } from "./schedule-ad-hoc-tasks";
import {
  assertCanDeleteAdHocTask,
  deleteAdHocTaskRecord,
} from "./delete-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "./constants";
import {
  AD_HOC_PERSON_NOT_FOUND_ERROR,
  formatAdHocPersonLabel,
  resolveAdHocNaveId,
} from "./resolve-ad-hoc-nave";
import { pickCanonicalPersonNave } from "@/features/people/person-naves";

const log = childLogger({ module: "ad-hoc.actions" });

const createAdHocTaskSchema = z.object({
  personIds: z.array(z.string().min(1)).min(1),
  estimatedHours: z.number().positive().max(24),
  notes: z.string().min(1).max(500),
  internalNotes: z.string().min(1).max(500),
  projectId: z.string().min(1),
  naveId: z.string().min(1).optional(),
  process: z.string().min(1).optional(),
});

function revalidateAdHocPaths() {
  revalidatePath("/dashboard/semana");
  revalidatePath("/dashboard/persona");
  revalidatePath("/dashboard/desviaciones-tiempos");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/gantt");
}

export async function createAdHocTask(
  input: z.infer<typeof createAdHocTaskSchema>,
): Promise<ActionResult<{ taskId: string; scheduledInPlanning: boolean }>> {
  return runServerAction(
    "ad-hoc.createAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createAdHocTaskSchema.parse(input);

      const uniquePersonIds = [...new Set(data.personIds)];
      const people = await prisma.person.findMany({
        where: { id: { in: uniquePersonIds }, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (people.length !== uniquePersonIds.length) {
        throw new Error(AD_HOC_PERSON_NOT_FOUND_ERROR);
      }

      const naveId = resolveAdHocNaveId(
        people.map((person) => ({
          personId: person.id,
          naveIds: person.personNaves.map((row) => row.naveId),
        })),
        data.naveId,
      );

      if (data.process) {
        const processDef = await prisma.processDefinition.findUnique({
          where: { code: data.process },
          select: { code: true },
        });
        if (!processDef) throw new Error("Proceso no encontrado.");
      }

      const result = await prisma.$transaction((tx) =>
        createAdHocTaskRecord(tx, {
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          notes: data.notes,
          internalNotes: data.internalNotes,
          projectId: data.projectId,
          process: data.process ?? IMPREVISTA_PROCESS_CODE,
          createdByUserId: ctx.userId,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          projectId: data.projectId,
          process: data.process,
        },
        "ad-hoc task created",
      );

      const injected = await injectPendingAdHocIntoDraftPlanning({
        naveId,
        taskIds: [result.taskId],
      });
      if (injected.scheduledCount > 0) {
        log.info(
          { taskId: result.taskId, naveId },
          "ad-hoc task injected into draft planning",
        );
      }

      revalidateAdHocPaths();
      return {
        taskId: result.taskId,
        scheduledInPlanning: injected.scheduledCount > 0,
      };
    },
    (result) => ({
      summary: "Crear tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
}

const updateAdHocTaskSchema = createAdHocTaskSchema.extend({
  taskId: z.string().min(1),
});

export async function updateAdHocTask(
  input: z.infer<typeof updateAdHocTaskSchema>,
): Promise<ActionResult<{ taskId: string }>> {
  return runServerAction(
    "ad-hoc.updateAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = updateAdHocTaskSchema.parse(input);

      const uniquePersonIds = [...new Set(data.personIds)];
      const people = await prisma.person.findMany({
        where: { id: { in: uniquePersonIds }, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (people.length !== uniquePersonIds.length) {
        throw new Error(AD_HOC_PERSON_NOT_FOUND_ERROR);
      }

      const naveId = resolveAdHocNaveId(
        people.map((person) => ({
          personId: person.id,
          naveIds: person.personNaves.map((row) => row.naveId),
        })),
        data.naveId,
      );

      if (data.process) {
        const processDef = await prisma.processDefinition.findUnique({
          where: { code: data.process },
          select: { code: true },
        });
        if (!processDef) throw new Error("Proceso no encontrado.");
      }

      const result = await prisma.$transaction((tx) =>
        updateAdHocTaskRecord(tx, {
          taskId: data.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          notes: data.notes,
          internalNotes: data.internalNotes,
          projectId: data.projectId,
          process: data.process ?? IMPREVISTA_PROCESS_CODE,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personIds: uniquePersonIds,
          naveId,
          estimatedHours: data.estimatedHours,
          projectId: data.projectId,
          process: data.process,
        },
        "ad-hoc task updated",
      );

      revalidateAdHocPaths();
      return { taskId: result.taskId };
    },
    (result) => ({
      summary: "Editar tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
}

const deleteAdHocTaskSchema = z.object({
  taskId: z.string().min(1),
});

export async function deleteAdHocTask(
  input: z.infer<typeof deleteAdHocTaskSchema>,
): Promise<ActionResult<void>> {
  return runServerAction(
    "ad-hoc.deleteAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = deleteAdHocTaskSchema.parse(input);

      const task = await prisma.task.findFirst({
        where: { id: data.taskId },
        include: { _count: { select: { timeEntries: true } } },
      });
      if (!task) throw new Error("Tarea no encontrada.");

      assertCanDeleteAdHocTask(task);

      await prisma.$transaction((tx) => deleteAdHocTaskRecord(tx, task.id));

      log.info({ taskId: task.id }, "ad-hoc task deleted");

      revalidateAdHocPaths();
    },
    () => ({
      summary: "Eliminar tarea imprevista",
      entityType: "Task",
      entityId: input.taskId,
    }),
  );
}

export interface PendingAdHocTaskRow {
  id: string;
  projectId: string;
  notes: string | null;
  internalNotes: string | null;
  projectName: string;
  process: string;
  estimatedHours: number;
  naveId: string;
  naveLabel: string;
  createdAt: string;
  hasTimeEntries: boolean;
  participants: Array<{ id: string; label: string }>;
}

export async function listPendingAdHocTasks(
  naveScope: string[] | null,
): Promise<PendingAdHocTaskRow[]> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  if (naveScope !== null && naveScope.length === 0) return [];

  const tasks = await prisma.task.findMany({
    where: {
      systemKind: TaskSystemKind.AD_HOC,
      isCompleted: false,
      assignments: { none: {} },
      ...(naveScope !== null ? { naveId: { in: naveScope } } : {}),
    },
    select: {
      id: true,
      notes: true,
      internalNotes: true,
      process: true,
      estimatedHours: true,
      naveId: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
      nave: { select: { codigo: true, nombre: true } },
      _count: { select: { timeEntries: true } },
      participants: {
        select: {
          person: {
            select: {
              id: true,
              iniciales: true,
              alias: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return tasks.map((task) => ({
    id: task.id,
    projectId: task.project.id,
    notes: task.notes,
    internalNotes: task.internalNotes,
    projectName: task.project.name,
    process: task.process,
    estimatedHours: task.estimatedHours,
    naveId: task.naveId,
    naveLabel: `${task.nave.codigo} · ${task.nave.nombre}`,
    createdAt: task.createdAt.toISOString(),
    hasTimeEntries: task._count.timeEntries > 0,
    participants: task.participants.map(({ person }) => {
      const name = person.user?.name ?? person.alias ?? person.iniciales;
      return {
        id: person.id,
        label: formatAdHocPersonLabel({ name, iniciales: person.iniciales }),
      };
    }),
  }));
}

export async function listAdHocFormOptions() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const [people, projects, naves, processes] = await Promise.all([
    prisma.person.findMany({
      where: { isActive: true },
      select: {
        id: true,
        iniciales: true,
        alias: true,
        user: { select: { name: true } },
        personNaves: {
          select: {
            naveId: true,
            nave: { select: { codigo: true } },
          },
        },
      },
      orderBy: { iniciales: "asc" },
    }),
    prisma.project.findMany({
      where: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.nave.findMany({
      where: { isActive: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.processDefinition.findMany({
      select: { code: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  return {
    people: people.map((person) => {
      const canonicalNave = pickCanonicalPersonNave(person.personNaves);
      const name = person.user?.name ?? person.alias ?? person.iniciales;
      const naveIds = person.personNaves.map((row) => row.naveId);
      return {
        id: person.id,
        label: formatAdHocPersonLabel({
          name,
          iniciales: person.iniciales,
          naveCodigo: canonicalNave?.nave.codigo,
        }),
        name,
        iniciales: person.iniciales,
        naveIds,
        defaultNaveId: canonicalNave?.naveId ?? null,
      };
    }),
    projects: projects.map((p) => ({
      id: p.id,
      label: `${p.name} (${p.code})`,
    })),
    naves: naves.map((n) => ({
      id: n.id,
      label: `${n.codigo} · ${n.nombre}`,
    })),
    processes: processes.map((p) => ({
      code: p.code,
      label: p.label,
    })),
  };
}
