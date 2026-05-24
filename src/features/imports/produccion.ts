import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { readDate, readNumber, readString } from "@/lib/excel/cell";
import { mapProcess } from "@/lib/excel/process-map";
import type { ProcessCode } from "@/types/process";

const log = childLogger({ module: "import.produccion" });

export interface ImportSummary {
  bastidores: { created: number; updated: number; skipped: number };
  projects: { created: number; updated: number; skipped: number };
  lamps: { created: number; updated: number; skipped: number };
  tasks: { created: number; updated: number; skipped: number };
  warnings: string[];
}

const argsSchema = z.object({
  filePath: z.string().min(1),
  naveId: z.string().min(1),
});

const emptySummary = (): ImportSummary => ({
  bastidores: { created: 0, updated: 0, skipped: 0 },
  projects: { created: 0, updated: 0, skipped: 0 },
  lamps: { created: 0, updated: 0, skipped: 0 },
  tasks: { created: 0, updated: 0, skipped: 0 },
  warnings: [],
});

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

async function importBastidores(
  wb: ExcelJS.Workbook,
  summary: ImportSummary,
): Promise<void> {
  const sheet = wb.getWorksheet("BBDD");
  if (!sheet) {
    summary.warnings.push("Hoja BBDD no encontrada");
    return;
  }

  const grouped = new Map<
    string,
    { name: string; processes: Map<ProcessCode, number> }
  >();

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const tipo = readString(row.getCell(7).value);
    const procName = readString(row.getCell(9).value);
    const hours = readNumber(row.getCell(10).value);
    if (!tipo || !procName || hours == null) continue;
    const procCode = mapProcess(procName);
    if (!procCode) {
      summary.warnings.push(`BBDD row ${r}: proceso desconocido "${procName}"`);
      continue;
    }
    const key = tipo.trim();
    if (!grouped.has(key)) grouped.set(key, { name: key, processes: new Map() });
    const entry = grouped.get(key)!;
    if (!entry.processes.has(procCode)) entry.processes.set(procCode, hours);
  }

  for (const [name, entry] of grouped) {
    const code = slug(name).slice(0, 64) || name;
    const existing = await prisma.frameType.findUnique({ where: { code } });
    const frameType = await prisma.frameType.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    if (existing) summary.bastidores.updated += 1;
    else summary.bastidores.created += 1;

    let sequence = 0;
    for (const [proc, hoursPerUnit] of entry.processes) {
      await prisma.frameTypeProcess.upsert({
        where: {
          frameTypeId_process: { frameTypeId: frameType.id, process: proc },
        },
        update: { sequence, hoursPerUnit },
        create: {
          frameTypeId: frameType.id,
          process: proc,
          sequence,
          hoursPerUnit,
        },
      });
      sequence += 1;
    }
  }
}

async function importProyectos(
  wb: ExcelJS.Workbook,
  naveId: string,
  summary: ImportSummary,
): Promise<void> {
  const sheet = wb.getWorksheet("🗂️ Proyectos");
  if (!sheet) {
    summary.warnings.push("Hoja Proyectos no encontrada");
    return;
  }

  const frameTypes = await prisma.frameType.findMany();
  const frameTypeByName = new Map(
    frameTypes.map((f) => [f.name.toUpperCase().trim(), f]),
  );

  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const proyectoName = readString(row.getCell(1).value);
    const lampName = readString(row.getCell(2).value);
    const bastidor = readString(row.getCell(3).value);
    const medida = readNumber(row.getCell(4).value);
    const fechaEntrega = readDate(row.getCell(5).value);
    const procName = readString(row.getCell(7).value);
    const hrPlan = readNumber(row.getCell(8).value);
    const hrPend = readNumber(row.getCell(13).value);
    const estado = readString(row.getCell(16).value);

    if (!proyectoName || !lampName || !procName) {
      summary.tasks.skipped += 1;
      continue;
    }
    const procCode = mapProcess(procName);
    if (!procCode) {
      summary.warnings.push(
        `Proyectos row ${r}: proceso desconocido "${procName}"`,
      );
      summary.tasks.skipped += 1;
      continue;
    }

    const projCode = slug(proyectoName).slice(0, 80) || proyectoName;
    const projExisting = await prisma.project.findUnique({
      where: { code: projCode },
    });
    const project = await prisma.project.upsert({
      where: { code: projCode },
      update: {
        name: proyectoName,
        deliveryDate: fechaEntrega ?? undefined,
        isActive: !(estado?.toLowerCase().includes("terminado") ?? false),
      },
      create: {
        code: projCode,
        name: proyectoName,
        deliveryDate: fechaEntrega ?? undefined,
      },
    });
    if (projExisting) summary.projects.updated += 1;
    else summary.projects.created += 1;

    const frameType = bastidor
      ? frameTypeByName.get(bastidor.toUpperCase().trim()) ?? null
      : null;
    const legacyFrame =
      frameType ??
      (await prisma.frameType.findFirst({ where: { code: "LEGACY" } })) ??
      (await prisma.frameType.findFirst());

    if (!legacyFrame) {
      summary.warnings.push(`Proyectos row ${r}: sin bastidor en catálogo`);
      summary.tasks.skipped += 1;
      continue;
    }

    let lamp = await prisma.lamp.findFirst({
      where: { projectId: project.id, name: lampName },
    });
    if (!lamp) {
      lamp = await prisma.lamp.create({
        data: {
          projectId: project.id,
          name: lampName,
          code: `${lampName}`.slice(0, 60),
          surfaceM2: medida ?? 1,
          frameTypeId: frameType?.id ?? legacyFrame.id,
        },
      });
      summary.lamps.created += 1;
    } else if (medida != null) {
      lamp = await prisma.lamp.update({
        where: { id: lamp.id },
        data: { surfaceM2: medida },
      });
      summary.lamps.updated += 1;
    }

    const estimated = hrPlan ?? hrPend ?? 0;
    const pending =
      hrPend != null
        ? hrPend
        : estimated > 0
          ? estimated
          : 0;
    const frameProcess = await prisma.frameTypeProcess.findUnique({
      where: {
        frameTypeId_process: {
          frameTypeId: lamp.frameTypeId,
          process: procCode,
        },
      },
    });
    let taskOrder: number;
    if (frameProcess) {
      taskOrder = frameProcess.sequence;
    } else {
      const maxOrder = await prisma.task.aggregate({
        where: { lampId: lamp.id },
        _max: { order: true },
      });
      taskOrder = (maxOrder._max.order ?? -1) + 1;
    }

    const taskExisting = await prisma.task.findFirst({
      where: { projectId: project.id, lampId: lamp.id, process: procCode },
    });
    if (taskExisting) {
      await prisma.task.update({
        where: { id: taskExisting.id },
        data: {
          estimatedHours: estimated,
          pendingHours: pending,
          doneHours: estimated - pending,
          order: taskOrder,
        },
      });
      summary.tasks.updated += 1;
    } else {
      await prisma.task.create({
        data: {
          projectId: project.id,
          lampId: lamp.id,
          process: procCode,
          estimatedHours: estimated,
          pendingHours: pending,
          doneHours: estimated - pending,
          order: taskOrder,
          naveId,
        },
      });
      summary.tasks.created += 1;
    }
  }
}

export async function importProduccion(args: {
  filePath: string;
  naveId: string;
}): Promise<ImportSummary> {
  const { filePath, naveId } = argsSchema.parse(args);
  log.info({ filePath, naveId }, "produccion import start");
  const summary = emptySummary();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  await importBastidores(wb, summary);
  await importProyectos(wb, naveId, summary);
  log.info({ summary }, "produccion import done");
  return summary;
}
