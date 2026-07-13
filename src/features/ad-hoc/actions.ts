"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { runAuditedMutation } from "@/lib/server-action";
import { Role } from "@/generated/prisma";
import { createAdHocTaskAndAssign } from "./create-ad-hoc-task";
import { IMPREVISTA_PROCESS_CODE } from "./constants";

const log = childLogger({ module: "ad-hoc.actions" });

const createAdHocTaskSchema = z.object({
  personId: z.string().min(1),
  notes: z.string().min(1).max(500),
  projectId: z.string().min(1).optional(),
  naveId: z.string().min(1).optional(),
  process: z.string().min(1).optional(),
});

export async function createAdHocTask(
  input: z.infer<typeof createAdHocTaskSchema>,
) {
  return runAuditedMutation(
    "ad-hoc.createAdHocTask",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createAdHocTaskSchema.parse(input);

      const person = await prisma.person.findFirst({
        where: { id: data.personId, isActive: true },
        include: {
          personNaves: { select: { naveId: true } },
        },
      });

      if (!person) throw new Error("Persona no encontrada.");

      let naveId = data.naveId;
      if (!naveId) {
        const personNaves = person.personNaves.map((row) => row.naveId);
        if (personNaves.length === 1) {
          naveId = personNaves[0];
        } else if (personNaves.length === 0) {
          throw new Error("El operario no tiene nave asignada.");
        } else {
          throw new Error("Selecciona la nave de la imprevista.");
        }
      }

      if (data.process) {
        const processDef = await prisma.processDefinition.findUnique({
          where: { code: data.process },
          select: { code: true },
        });
        if (!processDef) throw new Error("Proceso no encontrado.");
      }

      const result = await prisma.$transaction((tx) =>
        createAdHocTaskAndAssign(tx, {
          personId: data.personId,
          naveId,
          notes: data.notes,
          projectId: data.projectId,
          process: data.process ?? IMPREVISTA_PROCESS_CODE,
          createdByUserId: ctx.userId,
        }),
      );

      log.info(
        {
          taskId: result.taskId,
          personId: data.personId,
          naveId,
          projectId: data.projectId,
          process: data.process,
        },
        "ad-hoc task created",
      );

      revalidatePath("/dashboard/semana");
      revalidatePath("/dashboard/desviaciones-tiempos");
      return result;
    },
    (result) => ({
      summary: "Crear tarea imprevista",
      entityType: "Task",
      entityId: result.taskId,
    }),
  );
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
      const naveCodigo = person.personNaves[0]?.nave.codigo;
      const name = person.alias ?? person.iniciales;
      return {
        id: person.id,
        label: naveCodigo ? `${name} · ${naveCodigo}` : name,
        defaultNaveId: person.personNaves[0]?.naveId ?? null,
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
