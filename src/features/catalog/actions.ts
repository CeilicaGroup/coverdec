"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { ElementTypology, Role } from "@/generated/prisma";
import { PROCESS_CODE_PATTERN } from "@/types/process";
import { getFallbackNaveId } from "@/features/projects/task-nave";
import type { ActionResult } from "@/lib/action-result";
import { runServerAction } from "@/lib/server-action";

const processRowSchema = z.object({
  process: z.string().min(1),
  hoursPerUnit: z.number().nonnegative(),
  fixedHours: z.number().nonnegative().default(0),
  naveId: z.string().min(1).nullable().optional(),
});

const elementUpsertSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    typology: z.nativeEnum(ElementTypology),
    isActive: z.boolean().default(true),
    defaultNaveId: z.string().min(1).nullable().optional(),
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

export async function upsertElementType(
  input: z.infer<typeof elementUpsertSchema>,
): Promise<ActionResult<{ id: string; code: string }>> {
  return runServerAction("catalog.upsertElementType", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = elementUpsertSchema.parse(input);

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

  if (data.defaultNaveId) {
    const nave = await prisma.nave.findFirst({
      where: { id: data.defaultNaveId, isActive: true },
      select: { id: true },
    });
    if (!nave) throw new Error("La nave por defecto no está activa.");
  }

  const processNaveIds = [
    ...new Set(
      data.processes
        .map((p) => p.naveId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (processNaveIds.length > 0) {
    const activeCount = await prisma.nave.count({
      where: { id: { in: processNaveIds }, isActive: true },
    });
    if (activeCount !== processNaveIds.length) {
      throw new Error("Alguna nave de proceso no está activa.");
    }
  }

  const element = await prisma.elementType.upsert({
    where: { code: data.code },
    update: {
      name: data.name,
      description: data.description ?? null,
      typology: data.typology,
      isActive: data.isActive,
      ...(data.defaultNaveId !== undefined
        ? { defaultNaveId: data.defaultNaveId }
        : {}),
    },
    create: {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      typology: data.typology,
      isActive: data.isActive,
      defaultNaveId: data.defaultNaveId ?? null,
    },
  });

  for (let i = 0; i < data.processes.length; i++) {
    const p = data.processes[i];
    await prisma.elementTypeProcess.upsert({
      where: {
        elementTypeId_process: { elementTypeId: element.id, process: p.process },
      },
      update: {
        sequence: i,
        hoursPerUnit: p.hoursPerUnit,
        fixedHours: p.fixedHours,
        naveId: p.naveId ?? null,
      },
      create: {
        elementTypeId: element.id,
        process: p.process,
        sequence: i,
        hoursPerUnit: p.hoursPerUnit,
        fixedHours: p.fixedHours,
        naveId: p.naveId ?? null,
      },
    });
  }

  const keep = data.processes.map((p) => p.process);
  if (keep.length > 0) {
    await prisma.elementTypeProcess.deleteMany({
      where: { elementTypeId: element.id, process: { notIn: keep } },
    });
  } else {
    await prisma.elementTypeProcess.deleteMany({ where: { elementTypeId: element.id } });
  }

  revalidatePath("/dashboard/catalogo");
  return { id: element.id, code: element.code };
  });
}

const setActiveSchema = z.object({
  elementTypeId: z.string().min(1),
  isActive: z.boolean(),
});

const updateTypologyNaveSchema = z.object({
  typology: z.nativeEnum(ElementTypology),
  defaultNaveId: z.string().min(1).nullable(),
});

export async function updateTypologyDefaultNave(
  input: z.infer<typeof updateTypologyNaveSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.updateTypologyDefaultNave", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateTypologyNaveSchema.parse(input);

  if (data.defaultNaveId) {
    const nave = await prisma.nave.findFirst({
      where: { id: data.defaultNaveId, isActive: true },
      select: { id: true },
    });
    if (!nave) throw new Error("La nave por defecto no está activa.");
  }

  await prisma.elementTypologyNave.upsert({
    where: { typology: data.typology },
    update: { defaultNaveId: data.defaultNaveId },
    create: { typology: data.typology, defaultNaveId: data.defaultNaveId },
  });

  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard/proyectos");
  });
}

export async function setElementTypeActive(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.setElementTypeActive", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = setActiveSchema.parse(input);
  await prisma.elementType.update({
    where: { id: data.elementTypeId },
    data: { isActive: data.isActive },
  });
  revalidatePath("/dashboard/catalogo");
  });
}

const deleteElementSchema = z.object({ elementTypeId: z.string().min(1) });

async function countElementTypeReferences(elementTypeId: string) {
  const [lamps, lampElements] = await Promise.all([
    prisma.lamp.count({ where: { elementTypeId } }),
    prisma.lampElement.count({ where: { elementTypeId } }),
  ]);
  return { lamps, lampElements, total: lamps + lampElements };
}

export async function deleteElementType(
  input: z.infer<typeof deleteElementSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.deleteElementType", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const { elementTypeId } = deleteElementSchema.parse(input);

  const refs = await countElementTypeReferences(elementTypeId);
  if (refs.total > 0) {
    const parts: string[] = [];
    if (refs.lamps > 0) parts.push(`${refs.lamps} lámpara(s)`);
    if (refs.lampElements > 0) parts.push(`${refs.lampElements} elemento(s) de lámpara`);
    throw new Error(
      `ARCHIVE_ONLY: Hay referencias activas (${parts.join(", ")}). Solo se puede desactivar.`,
    );
  }

  await prisma.$transaction([
    prisma.elementTypeProcess.deleteMany({ where: { elementTypeId } }),
    prisma.elementType.delete({ where: { id: elementTypeId } }),
  ]);
  revalidatePath("/dashboard/catalogo");
  });
}

const duplicateElementSchema = z.object({
  elementTypeId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
});

export async function duplicateElementType(
  input: z.infer<typeof duplicateElementSchema>,
): Promise<ActionResult<{ id: string; code: string }>> {
  return runServerAction("catalog.duplicateElementType", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = duplicateElementSchema.parse(input);
    const code = data.code.trim().toUpperCase();

    const source = await prisma.elementType.findUnique({
      where: { id: data.elementTypeId },
      include: { processes: { orderBy: { sequence: "asc" } } },
    });
    if (!source) throw new Error("Elemento no encontrado.");

    const existing = await prisma.elementType.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`Ya existe un elemento con el código «${code}».`);
    }

    const created = await prisma.$transaction(async (tx) => {
      const element = await tx.elementType.create({
        data: {
          code,
          name: data.name.trim(),
          description: source.description,
          typology: source.typology,
          isActive: true,
          defaultNaveId: source.defaultNaveId,
        },
      });
      for (const process of source.processes) {
        await tx.elementTypeProcess.create({
          data: {
            elementTypeId: element.id,
            process: process.process,
            sequence: process.sequence,
            hoursPerUnit: process.hoursPerUnit,
            fixedHours: process.fixedHours,
            naveId: process.naveId,
          },
        });
      }
      return element;
    });

    revalidatePath("/dashboard/catalogo");
    return { id: created.id, code: created.code };
  });
}

const TYPOLOGY_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const TYPOLOGY_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upsertTypologyImageSchema = z.object({
  typology: z.nativeEnum(ElementTypology),
  imageBase64: z.string().min(1),
  mimeType: z.string().min(1),
});

export async function upsertTypologyImage(
  input: z.infer<typeof upsertTypologyImageSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.upsertTypologyImage", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = upsertTypologyImageSchema.parse(input);

    if (!TYPOLOGY_IMAGE_MIMES.has(data.mimeType)) {
      throw new Error("Formato no permitido. Usa JPEG, PNG o WebP.");
    }

    const buffer = Buffer.from(data.imageBase64, "base64");
    if (buffer.length === 0) throw new Error("La imagen está vacía.");
    if (buffer.length > TYPOLOGY_IMAGE_MAX_BYTES) {
      throw new Error("La imagen supera el máximo de 2 MB.");
    }

    await prisma.elementTypologyNave.upsert({
      where: { typology: data.typology },
      update: {
        imageData: buffer,
        imageMimeType: data.mimeType,
        imageUpdatedAt: new Date(),
      },
      create: {
        typology: data.typology,
        imageData: buffer,
        imageMimeType: data.mimeType,
        imageUpdatedAt: new Date(),
      },
    });

    revalidatePath("/dashboard/catalogo");
  });
}

const deleteTypologyImageSchema = z.object({
  typology: z.nativeEnum(ElementTypology),
});

export async function deleteTypologyImage(
  input: z.infer<typeof deleteTypologyImageSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.deleteTypologyImage", async () => {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
    const data = deleteTypologyImageSchema.parse(input);

    await prisma.elementTypologyNave.update({
      where: { typology: data.typology },
      data: {
        imageData: null,
        imageMimeType: null,
        imageUpdatedAt: null,
      },
    });

    revalidatePath("/dashboard/catalogo");
  });
}

const updateProcessSchema = z.object({
  code: z.string().min(1),
  waitHours: z.number().min(0).max(168),
  setupHours: z.number().min(0).max(168).optional(),
  label: z.string().min(1).max(120),
  bgColor: z.string().min(1),
  fgColor: z.string().min(1),
  borderColor: z.string().min(1),
  canFragment: z.boolean().default(true),
});

export async function updateProcessDefinition(
  input: z.infer<typeof updateProcessSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.updateProcessDefinition", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = updateProcessSchema.parse(input);

  await prisma.processDefinition.update({
    where: { code: data.code },
    data: {
      waitHours: data.waitHours,
      ...(data.setupHours !== undefined ? { setupHours: data.setupHours } : {}),
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
  });
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
): Promise<ActionResult<void>> {
  return runServerAction("catalog.createProcessDefinition", async () => {
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
  });
}

export interface ProcessDefinitionUsage {
  tasks: number;
  elementTypeProcesses: number;
  personSpecialties: number;
  timeEntries: number;
  productionOrders: number;
  planningAssignments: number;
}

async function loadProcessDefinitionUsage(
  code: string,
): Promise<ProcessDefinitionUsage> {
  const [tasks, elementTypeProcesses, personSpecialties, timeEntries, productionOrders, planningAssignments] =
    await Promise.all([
      prisma.task.count({ where: { process: code } }),
      prisma.elementTypeProcess.count({ where: { process: code } }),
      prisma.personSpecialty.count({ where: { process: code } }),
      prisma.timeEntry.count({ where: { process: code } }),
      prisma.productionOrder.count({ where: { process: code } }),
      prisma.planningAssignment.count({ where: { process: code } }),
    ]);
  return {
    tasks,
    elementTypeProcesses,
    personSpecialties,
    timeEntries,
    productionOrders,
    planningAssignments,
  };
}

function totalProcessUsage(usage: ProcessDefinitionUsage): number {
  return (
    usage.tasks +
    usage.elementTypeProcesses +
    usage.personSpecialties +
    usage.timeEntries +
    usage.productionOrders +
    usage.planningAssignments
  );
}

const processCodeSchema = z.object({
  code: z.string().min(1),
});

export async function getProcessDefinitionUsage(
  input: z.infer<typeof processCodeSchema>,
): Promise<ProcessDefinitionUsage> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = processCodeSchema.parse(input);
  return loadProcessDefinitionUsage(data.code);
}

const deleteProcessSchema = z.object({
  code: z.string().min(1),
});

export async function deleteProcessDefinition(
  input: z.infer<typeof deleteProcessSchema>,
): Promise<ActionResult<void>> {
  return runServerAction("catalog.deleteProcessDefinition", async () => {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const data = deleteProcessSchema.parse(input);

  const usage = await loadProcessDefinitionUsage(data.code);
  if (totalProcessUsage(usage) > 0) {
    throw new Error(
      "PROCESS_IN_USE:No se puede eliminar: el proceso está en uso.",
    );
  }

  await prisma.processDefinition.delete({ where: { code: data.code } });

  revalidatePath("/dashboard/catalogo");
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/personal");
  });
}
