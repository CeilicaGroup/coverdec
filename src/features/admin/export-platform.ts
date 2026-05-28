import ExcelJS from "exceljs";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { loadDoneHoursByTaskIds } from "@/features/time-tracking/task-hours-derived";
import { childLogger } from "@/lib/logger";

const log = childLogger({ module: "admin.export-platform" });

const DATE_FORMAT = "yyyy-mm-dd hh:mm:ss";
const TIME_ENTRY_BATCH_SIZE = 2000;

interface ExportWorkbookResult {
  buffer: Buffer;
  filename: string;
}

interface ExportFilters {
  from?: Date;
  to?: Date;
}

interface WorksheetColumn {
  header: string;
  key: string;
  width: number;
  style?: Partial<ExcelJS.Style>;
}

function addWorksheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: WorksheetColumn[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  return sheet;
}

function toNullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function toFileStamp(date: Date): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

async function fillProjectsSheet(
  workbook: ExcelJS.Workbook,
  filters: ExportFilters,
): Promise<void> {
  const sheet = addWorksheet(workbook, "Proyectos", [
    { header: "ID", key: "id", width: 28 },
    { header: "Codigo", key: "code", width: 20 },
    { header: "Nombre", key: "name", width: 32 },
    { header: "Cliente", key: "client", width: 24 },
    { header: "Obra", key: "obra", width: 28 },
    { header: "FechaEntrega", key: "deliveryDate", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Facturable", key: "isBillable", width: 12 },
    { header: "Activo", key: "isActive", width: 10 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Creado", key: "createdAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Actualizado", key: "updatedAt", width: 20, style: { numFmt: DATE_FORMAT } },
  ]);

  const where: Prisma.ProjectWhereInput | undefined =
    filters.from || filters.to
      ? { createdAt: { gte: filters.from, lte: filters.to } }
      : undefined;
  const projects = await prisma.project.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      client: true,
      obra: true,
      deliveryDate: true,
      isBillable: true,
      isActive: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  for (const project of projects) {
    sheet.addRow({
      id: project.id,
      code: project.code,
      name: project.name,
      client: toNullable(project.client),
      obra: toNullable(project.obra),
      deliveryDate: project.deliveryDate,
      isBillable: project.isBillable,
      isActive: project.isActive,
      notes: toNullable(project.notes),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });
  }
}

async function fillTasksSheet(
  workbook: ExcelJS.Workbook,
  filters: ExportFilters,
): Promise<void> {
  const sheet = addWorksheet(workbook, "Tareas", [
    { header: "ID", key: "id", width: 28 },
    { header: "ProyectoCodigo", key: "projectCode", width: 18 },
    { header: "ProyectoNombre", key: "projectName", width: 28 },
    { header: "Lampara", key: "lampName", width: 28 },
    { header: "Bastidor", key: "lampFrameLabel", width: 22 },
    { header: "Proceso", key: "process", width: 18 },
    { header: "HorasEstimadas", key: "estimatedHours", width: 14 },
    { header: "HorasPendientes", key: "pendingHours", width: 14 },
    { header: "HorasHechas", key: "doneHours", width: 14 },
    { header: "Completada", key: "isCompleted", width: 12 },
    { header: "Orden", key: "order", width: 10 },
    { header: "NaveCodigo", key: "naveCodigo", width: 14 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Creado", key: "createdAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Actualizado", key: "updatedAt", width: 20, style: { numFmt: DATE_FORMAT } },
  ]);

  const where: Prisma.TaskWhereInput | undefined =
    filters.from || filters.to
      ? { createdAt: { gte: filters.from, lte: filters.to } }
      : undefined;
  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      process: true,
      estimatedHours: true,
      isCompleted: true,
      order: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      project: { select: { code: true, name: true } },
      lamp: { select: { name: true } },
      lampFrame: { select: { label: true } },
      nave: { select: { codigo: true } },
    },
  });
  const doneByTaskId = await loadDoneHoursByTaskIds(
    prisma,
    tasks.map((task) => task.id),
  );

  for (const task of tasks) {
    sheet.addRow({
      id: task.id,
      projectCode: task.project.code,
      projectName: task.project.name,
      lampName: task.lamp.name,
      lampFrameLabel: toNullable(task.lampFrame?.label),
      process: task.process,
      estimatedHours: task.estimatedHours,
      pendingHours: Math.max(0, task.estimatedHours - (doneByTaskId.get(task.id) ?? 0)),
      doneHours: doneByTaskId.get(task.id) ?? 0,
      isCompleted: task.isCompleted,
      order: task.order,
      naveCodigo: task.nave.codigo,
      notes: toNullable(task.notes),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  }
}

async function fillFramesSheet(
  workbook: ExcelJS.Workbook,
  filters: ExportFilters,
): Promise<void> {
  const sheet = addWorksheet(workbook, "Bastidores", [
    { header: "BastidorID", key: "frameTypeId", width: 28 },
    { header: "BastidorCodigo", key: "frameTypeCode", width: 20 },
    { header: "BastidorNombre", key: "frameTypeName", width: 28 },
    { header: "Activo", key: "isActive", width: 10 },
    { header: "Proceso", key: "process", width: 18 },
    { header: "Secuencia", key: "sequence", width: 10 },
    { header: "HorasPorUnidad", key: "hoursPerUnit", width: 14 },
    { header: "HorasFijas", key: "fixedHours", width: 12 },
    { header: "Notas", key: "notes", width: 36 },
    { header: "Creado", key: "frameTypeCreatedAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Actualizado", key: "frameTypeUpdatedAt", width: 20, style: { numFmt: DATE_FORMAT } },
  ]);

  const where: Prisma.FrameTypeProcessWhereInput | undefined =
    filters.from || filters.to
      ? { frameType: { createdAt: { gte: filters.from, lte: filters.to } } }
      : undefined;
  const frameTypeProcesses = await prisma.frameTypeProcess.findMany({
    where,
    orderBy: [{ frameType: { createdAt: "asc" } }, { frameTypeId: "asc" }, { sequence: "asc" }, { id: "asc" }],
    select: {
      process: true,
      sequence: true,
      hoursPerUnit: true,
      fixedHours: true,
      notes: true,
      frameType: {
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  for (const item of frameTypeProcesses) {
    sheet.addRow({
      frameTypeId: item.frameType.id,
      frameTypeCode: item.frameType.code,
      frameTypeName: item.frameType.name,
      isActive: item.frameType.isActive,
      process: item.process,
      sequence: item.sequence,
      hoursPerUnit: item.hoursPerUnit,
      fixedHours: item.fixedHours,
      notes: toNullable(item.notes),
      frameTypeCreatedAt: item.frameType.createdAt,
      frameTypeUpdatedAt: item.frameType.updatedAt,
    });
  }
}

async function fillTimeEntriesSheet(
  workbook: ExcelJS.Workbook,
  filters: ExportFilters,
): Promise<void> {
  const sheet = addWorksheet(workbook, "RegistrosHoras", [
    { header: "ID", key: "id", width: 28 },
    { header: "Usuario", key: "userName", width: 24 },
    { header: "Email", key: "userEmail", width: 30 },
    { header: "Rol", key: "role", width: 16 },
    { header: "ProyectoCodigo", key: "projectCode", width: 18 },
    { header: "ProyectoNombre", key: "projectName", width: 28 },
    { header: "Lampara", key: "lampName", width: 28 },
    { header: "TaskID", key: "taskId", width: 28 },
    { header: "Proceso", key: "process", width: 18 },
    { header: "Origen", key: "source", width: 12 },
    { header: "Inicio", key: "startedAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Fin", key: "endedAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Horas", key: "hours", width: 12 },
    { header: "Notas", key: "notes", width: 40 },
    { header: "Creado", key: "createdAt", width: 20, style: { numFmt: DATE_FORMAT } },
    { header: "Actualizado", key: "updatedAt", width: 20, style: { numFmt: DATE_FORMAT } },
  ]);

  let cursorId: string | null = null;
  let processed = 0;
  const timeEntrySelect = {
    id: true,
    source: true,
    startedAt: true,
    endedAt: true,
    hours: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    user: { select: { name: true, email: true, role: true } },
    project: { select: { code: true, name: true } },
    lamp: { select: { name: true } },
    taskId: true,
    process: true,
  } satisfies Prisma.TimeEntrySelect;
  type TimeEntryExportRow = Prisma.TimeEntryGetPayload<{
    select: typeof timeEntrySelect;
  }>;

  while (true) {
    const batch: TimeEntryExportRow[] = await prisma.timeEntry.findMany({
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: TIME_ENTRY_BATCH_SIZE,
      orderBy: { id: "asc" },
      select: timeEntrySelect,
      where:
        filters.from || filters.to
          ? { startedAt: { gte: filters.from, lte: filters.to } }
          : undefined,
    });

    if (batch.length === 0) break;

    for (const entry of batch) {
      sheet.addRow({
        id: entry.id,
        userName: entry.user.name,
        userEmail: entry.user.email,
        role: entry.user.role,
        projectCode: toNullable(entry.project?.code),
        projectName: toNullable(entry.project?.name),
        lampName: toNullable(entry.lamp?.name),
        taskId: toNullable(entry.taskId),
        process: toNullable(entry.process),
        source: entry.source,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        hours: entry.hours,
        notes: toNullable(entry.notes),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
    }

    processed += batch.length;
    cursorId = batch[batch.length - 1]?.id ?? null;
  }

  log.info({ processed }, "time entries exported");
}

export async function buildPlatformExportWorkbook(
  filters: ExportFilters = {},
): Promise<ExportWorkbookResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "CoverDec";
  workbook.created = new Date();
  workbook.modified = new Date();

  await fillProjectsSheet(workbook, filters);
  await fillTasksSheet(workbook, filters);
  await fillFramesSheet(workbook, filters);
  await fillTimeEntriesSheet(workbook, filters);

  const data = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(data);
  const filename = `platform-export-${toFileStamp(new Date())}.xlsx`;
  return { buffer, filename };
}
