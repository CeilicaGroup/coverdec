import { PlanningStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { toUtcDay } from "@/lib/week";
import {
  buildProcessBatchSuffix,
  isPaintProcess,
  resolveRalFromLamp,
} from "./grouping-rules";

export interface WorkOrderLinePreview {
  taskId: string;
  projectId: string;
  projectName: string;
  units: number;
  hours: number;
  ral: string | null;
  colorHex: string | null;
}

export interface WorkOrderBatchPreview {
  batchKey: string;
  process: string;
  naveId: string;
  elementTypeId: string | null;
  batchRal: string | null;
  scheduledWeek: string;
  planningGroupId: string | null;
  hours: number;
  scheduledAt: string | null;
  lines: WorkOrderLinePreview[];
  skippedExisting: boolean;
}

interface GroupedLine {
  taskId: string;
  projectId: string;
  projectName: string;
  units: number;
  hours: number;
  ral: string | null;
  colorHex: string | null;
}

interface RawAssignment {
  hours: number;
  date: Date;
  process: string;
  task: {
    id: string;
    naveId: string;
    separateWorkOrder: boolean;
    projectId: string;
    project: { name: string };
    lamp: {
      ral: string | null;
      colorHex: string | null;
      notes: string | null;
      name: string;
      code: string | null;
    };
    lampElement: { elementTypeId: string; units: number } | null;
  };
  planning: {
    naveId: string;
    weekStart: Date;
    planningGroupId: string | null;
  };
}

function buildBatchKey(args: {
  planningGroupId: string | null;
  weekStartIso: string;
  process: string;
  naveId: string;
  elementTypeId: string | null;
  ral: string | null;
  taskId: string;
  separateWorkOrder: boolean;
}): string {
  const base = [
    args.planningGroupId ?? "solo",
    args.weekStartIso,
    args.process,
    args.naveId,
  ].join("|");
  const suffix = buildProcessBatchSuffix({
    process: args.process,
    elementTypeId: args.elementTypeId,
    ral: args.ral,
    taskId: args.taskId,
    separateWorkOrder: args.separateWorkOrder,
  });
  return `${base}|${suffix}`;
}

export function groupAssignmentsIntoBatches(
  assignments: RawAssignment[],
): Omit<WorkOrderBatchPreview, "skippedExisting">[] {
  const batches = new Map<
    string,
    {
      batchKey: string;
      process: string;
      naveId: string;
      elementTypeId: string | null;
      batchRal: string | null;
      scheduledWeek: string;
      planningGroupId: string | null;
      hours: number;
      earliestDate: Date | null;
      lines: Map<string, GroupedLine>;
    }
  >();

  for (const a of assignments) {
    const weekStart = toUtcDay(a.planning.weekStart);
    const weekStartIso = weekStart.toISOString().slice(0, 10);
    const elementTypeId = a.task.lampElement?.elementTypeId ?? null;
    const { ral, colorHex } = resolveRalFromLamp(a.task.lamp);
    const batchKey = buildBatchKey({
      planningGroupId: a.planning.planningGroupId,
      weekStartIso,
      process: a.process,
      naveId: a.task.naveId,
      elementTypeId,
      ral,
      taskId: a.task.id,
      separateWorkOrder: a.task.separateWorkOrder,
    });

    let batch = batches.get(batchKey);
    if (!batch) {
      batch = {
        batchKey,
        process: a.process,
        naveId: a.task.naveId,
        elementTypeId,
        batchRal: isPaintProcess(a.process) ? ral : null,
        scheduledWeek: weekStartIso,
        planningGroupId: a.planning.planningGroupId,
        hours: 0,
        earliestDate: null,
        lines: new Map(),
      };
      batches.set(batchKey, batch);
    }

    batch.hours += a.hours;
    const day = toUtcDay(a.date);
    if (!batch.earliestDate || day < batch.earliestDate) {
      batch.earliestDate = day;
    }

    const lineKey = a.task.id;
    const existing = batch.lines.get(lineKey);
    const units = a.task.lampElement?.units ?? 1;
    if (existing) {
      existing.hours += a.hours;
    } else {
      batch.lines.set(lineKey, {
        taskId: a.task.id,
        projectId: a.task.projectId,
        projectName: a.task.project.name,
        units,
        hours: a.hours,
        ral,
        colorHex,
      });
    }
  }

  return [...batches.values()]
    .sort((a, b) => a.batchKey.localeCompare(b.batchKey, "es"))
    .map((batch) => ({
      batchKey: batch.batchKey,
      process: batch.process,
      naveId: batch.naveId,
      elementTypeId: batch.elementTypeId,
      batchRal: batch.batchRal,
      scheduledWeek: batch.scheduledWeek,
      planningGroupId: batch.planningGroupId,
      hours: Math.round(batch.hours * 100) / 100,
      scheduledAt: batch.earliestDate?.toISOString().slice(0, 10) ?? null,
      lines: [...batch.lines.values()].sort((a, b) =>
        a.projectName.localeCompare(b.projectName, "es"),
      ),
    }));
}

async function loadPublishedAssignments(args: {
  naveIds: string[];
  year: number;
  week: number;
}): Promise<RawAssignment[]> {
  return prisma.planningAssignment.findMany({
    where: {
      planning: {
        naveId: { in: args.naveIds },
        year: args.year,
        week: args.week,
        status: PlanningStatus.PUBLISHED,
      },
    },
    select: {
      hours: true,
      date: true,
      process: true,
      task: {
        select: {
          id: true,
          naveId: true,
          separateWorkOrder: true,
          projectId: true,
          project: { select: { name: true } },
          lamp: {
            select: {
              ral: true,
              colorHex: true,
              notes: true,
              name: true,
              code: true,
            },
          },
          lampElement: { select: { elementTypeId: true, units: true } },
        },
      },
      planning: {
        select: {
          naveId: true,
          weekStart: true,
          planningGroupId: true,
        },
      },
    },
  });
}

async function batchAlreadyExists(args: {
  planningGroupId: string | null;
  process: string;
  naveId: string;
  elementTypeId: string | null;
  scheduledWeek: Date;
  batchRal?: string | null;
  separateTaskId?: string;
}): Promise<boolean> {
  const baseWhere = {
    planningGroupId: args.planningGroupId,
    process: args.process,
    naveId: args.naveId,
    elementTypeId: args.elementTypeId,
    scheduledWeek: args.scheduledWeek,
  };

  if (args.separateTaskId) {
    const existing = await prisma.productionOrder.findFirst({
      where: {
        ...baseWhere,
        lines: { some: { taskId: args.separateTaskId } },
      },
      select: { id: true },
    });
    return existing !== null;
  }

  if (args.batchRal) {
    const candidates = await prisma.productionOrder.findMany({
      where: baseWhere,
      select: { id: true, lines: { select: { ral: true } } },
    });
    return candidates.some((order) =>
      order.lines.length > 0 &&
      order.lines.every((l) => l.ral === args.batchRal),
    );
  }

  const existing = await prisma.productionOrder.findFirst({
    where: baseWhere,
    select: { id: true },
  });
  return existing !== null;
}

export async function previewWorkOrdersFromPlanning(args: {
  naveIds: string[];
  year: number;
  week: number;
}): Promise<WorkOrderBatchPreview[]> {
  const assignments = await loadPublishedAssignments(args);
  const batches = groupAssignmentsIntoBatches(assignments);

  const enriched: WorkOrderBatchPreview[] = [];
  for (const batch of batches) {
    const scheduledWeek = toUtcDay(new Date(`${batch.scheduledWeek}T00:00:00.000Z`));
    const separateTaskId =
      batch.lines.length === 1 && batch.batchKey.includes("|task:")
        ? batch.lines[0]!.taskId
        : undefined;
    const skippedExisting = await batchAlreadyExists({
      planningGroupId: batch.planningGroupId,
      process: batch.process,
      naveId: batch.naveId,
      elementTypeId: batch.elementTypeId,
      scheduledWeek,
      batchRal: batch.batchRal,
      separateTaskId,
    });
    enriched.push({ ...batch, skippedExisting });
  }
  return enriched;
}

export async function generateWorkOrdersFromPlanning(args: {
  naveIds: string[];
  year: number;
  week: number;
  batchKeys?: string[];
}): Promise<{ created: number; skipped: number; numbers: string[] }> {
  const previews = await previewWorkOrdersFromPlanning(args);
  const selected = args.batchKeys?.length
    ? previews.filter((b) => args.batchKeys!.includes(b.batchKey))
    : previews;
  const toCreate = selected.filter((b) => !b.skippedExisting && b.lines.length > 0);

  if (toCreate.length === 0) {
    return { created: 0, skipped: selected.length, numbers: [] };
  }

  const numbers: string[] = [];
  let created = 0;
  const skipped = selected.length - toCreate.length;

  await prisma.$transaction(async (tx) => {
    const orderYear = new Date().getUTCFullYear();
    const last = await tx.productionOrder.findFirst({
      where: { year: orderYear },
      orderBy: { serial: "desc" },
    });
    let nextSerial = (last?.serial ?? 0) + 1;

    for (const batch of toCreate) {
      const scheduledWeek = toUtcDay(
        new Date(`${batch.scheduledWeek}T00:00:00.000Z`),
      );

      const serial = nextSerial;
      nextSerial += 1;
      const number = `OP${String(serial).padStart(4, "0")}-${orderYear}`;
      const headerProjectId =
        batch.lines.length === 1 ? batch.lines[0]!.projectId : undefined;

      const order = await tx.productionOrder.create({
        data: {
          number,
          year: orderYear,
          serial,
          projectId: headerProjectId,
          process: batch.process,
          hours: batch.hours,
          scheduledAt: batch.scheduledAt
            ? new Date(`${batch.scheduledAt}T00:00:00.000Z`)
            : scheduledWeek,
          naveId: batch.naveId,
          elementTypeId: batch.elementTypeId,
          scheduledWeek,
          planningGroupId: batch.planningGroupId,
          lines: {
            create: batch.lines.map((line) => ({
              taskId: line.taskId,
              projectId: line.projectId,
              units: line.units,
              ral: line.ral,
              colorHex: line.colorHex,
            })),
          },
        },
      });

      numbers.push(order.number);
      created += 1;
    }
  });

  return { created, skipped, numbers };
}
