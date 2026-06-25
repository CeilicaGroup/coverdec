import {
  ElementRouteType,
  ProductionOrderKind,
  ProductionOrderStatus,
  type Prisma,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  parseOrderRouteMeta,
  detectN3ToN2Transfer,
  serializeOrderNotesWithRoute,
  parseSeqPhasesJson,
  type SeqPhase,
} from "./route-meta";
import {
  parseOrderExecutionMeta,
  serializeOrderNotes,
} from "./execution";

export interface ProjectOrderPreview {
  lampId: string;
  lampName: string;
  elementTypeCode: string;
  naveKey: string;
  process: string | null;
  hours: number;
  units: number;
  ral: string | null;
  skippedExisting: boolean;
  existingOrderNumber?: string;
}

interface ElementTypeRoute {
  id: string;
  code: string;
  routeType: ElementRouteType;
  routeNaves: string[];
  seqPhases: unknown;
  processes: Array<{
    process: string;
    hoursPerUnit: number;
    fixedHours: number;
    notes: string | null;
    sequence: number;
  }>;
}

interface LampInput {
  id: string;
  name: string;
  units: number;
  ral: string | null;
  colorHex: string | null;
  elementType: ElementTypeRoute | null;
}

export function expandNaveKeysForRoute(routeType: ElementRouteType, routeNaves: string[]): string[] {
  if (routeNaves.length === 0) return ["N2"];
  if (routeType === ElementRouteType.SIMPLE) return [routeNaves[0]!];
  return routeNaves;
}

export function estimateHoursForNaveKey(args: {
  naveKey: string;
  units: number;
  elementType: ElementTypeRoute;
  seqPhases?: SeqPhase[];
}): { hours: number; process: string | null } {
  if (args.naveKey === "SEQ" && args.seqPhases?.length) {
    const total = args.seqPhases.reduce(
      (sum, phase) =>
        sum +
        (phase.fixedHours ?? 0) +
        (phase.hoursPerUnit ?? 0) * args.units,
      0,
    );
    const first = args.seqPhases[0]!;
    return { hours: Math.round(total * 100) / 100, process: first.process };
  }

  const processes = args.elementType.processes.filter(
    (p) => p.notes?.trim().toUpperCase() === args.naveKey.toUpperCase(),
  );
  if (processes.length === 0) {
    const fallback = args.elementType.processes[0];
    if (!fallback) return { hours: 0, process: null };
    const hours =
      fallback.fixedHours + fallback.hoursPerUnit * args.units;
    return { hours: Math.round(hours * 100) / 100, process: fallback.process };
  }
  const hours = processes.reduce(
    (sum, p) => sum + p.fixedHours + p.hoursPerUnit * args.units,
    0,
  );
  return {
    hours: Math.round(hours * 100) / 100,
    process: processes[0]!.process,
  };
}

export function buildPreviewsForLamp(
  lamp: LampInput,
  existingKeys: Set<string>,
  existingNumbers: Map<string, string>,
): ProjectOrderPreview[] {
  const et = lamp.elementType;
  if (!et) return [];

  const seqPhases = parseSeqPhasesJson(et.seqPhases);
  const naveKeys = expandNaveKeysForRoute(et.routeType, et.routeNaves);
  const previews: ProjectOrderPreview[] = [];

  for (const naveKey of naveKeys) {
    const key = `${lamp.id}:${naveKey}`;
    const { hours, process } = estimateHoursForNaveKey({
      naveKey,
      units: lamp.units,
      elementType: et,
      seqPhases: naveKey === "SEQ" ? seqPhases : undefined,
    });
    previews.push({
      lampId: lamp.id,
      lampName: lamp.name,
      elementTypeCode: et.code,
      naveKey,
      process,
      hours,
      units: lamp.units,
      ral: lamp.ral,
      skippedExisting: existingKeys.has(key),
      existingOrderNumber: existingNumbers.get(key),
    });
  }
  return previews;
}

async function loadLampsForProject(projectId: string, lampIds?: string[]) {
  return prisma.lamp.findMany({
    where: {
      projectId,
      ...(lampIds?.length ? { id: { in: lampIds } } : {}),
      elementTypeId: { not: null },
    },
    include: {
      elementType: {
        include: {
          processes: { orderBy: { sequence: "asc" } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

async function loadExistingProjectOrderKeys(projectId: string) {
  const existing = await prisma.productionOrder.findMany({
    where: {
      projectId,
      lampId: { not: null },
      status: { not: ProductionOrderStatus.CERR },
    },
    select: { lampId: true, naveKey: true, number: true },
  });
  const keys = new Set<string>();
  const numbers = new Map<string, string>();
  for (const row of existing) {
    if (!row.lampId || !row.naveKey) continue;
    const key = `${row.lampId}:${row.naveKey}`;
    keys.add(key);
    numbers.set(key, row.number);
  }
  return { keys, numbers };
}

export async function previewProductionOrdersFromProject(args: {
  projectId: string;
  lampIds?: string[];
}): Promise<{ previews: ProjectOrderPreview[] }> {
  const lamps = await loadLampsForProject(args.projectId, args.lampIds);
  const { keys, numbers } = await loadExistingProjectOrderKeys(args.projectId);

  const previews = lamps.flatMap((lamp) =>
    buildPreviewsForLamp(
      {
        id: lamp.id,
        name: lamp.name,
        units: lamp.units,
        ral: lamp.ral,
        colorHex: lamp.colorHex,
        elementType: lamp.elementType
          ? {
              id: lamp.elementType.id,
              code: lamp.elementType.code,
              routeType: lamp.elementType.routeType,
              routeNaves: lamp.elementType.routeNaves,
              seqPhases: lamp.elementType.seqPhases,
              processes: lamp.elementType.processes,
            }
          : null,
      },
      keys,
      numbers,
    ),
  );

  return { previews };
}

export async function createProductionOrdersFromProject(args: {
  projectId: string;
  lampIds?: string[];
}): Promise<{ created: number; numbers: string[]; skipped: number }> {
  const project = await prisma.project.findUnique({
    where: { id: args.projectId },
    select: { id: true },
  });
  if (!project) throw new Error("Proyecto no encontrado.");

  const { previews } = await previewProductionOrdersFromProject(args);
  const pending = previews.filter((p) => !p.skippedExisting);
  if (pending.length === 0) {
    return { created: 0, numbers: [], skipped: previews.length };
  }

  const naveByCodigo = new Map(
    (
      await prisma.nave.findMany({
        where: { isActive: true },
        select: { id: true, codigo: true },
      })
    ).map((n) => [n.codigo, n.id]),
  );

  const lamps = await loadLampsForProject(args.projectId, args.lampIds);
  const lampById = new Map(lamps.map((l) => [l.id, l]));

  const year = new Date().getUTCFullYear();
  let lastSerial =
    (
      await prisma.productionOrder.findFirst({
        where: { year },
        orderBy: { serial: "desc" },
        select: { serial: true },
      })
    )?.serial ?? 0;

  const numbers: string[] = [];
  let skipped = previews.filter((p) => p.skippedExisting).length;

  for (const preview of pending) {
    const lamp = lampById.get(preview.lampId);
    const et = lamp?.elementType;
    if (!lamp || !et) continue;

    const seqPhases =
      preview.naveKey === "SEQ" ? parseSeqPhasesJson(et.seqPhases) : [];
    const naveId =
      preview.naveKey === "SEQ"
        ? (naveByCodigo.get("N3") ?? naveByCodigo.get("N2") ?? null)
        : (naveByCodigo.get(preview.naveKey) ?? null);

    let userNotes = "";
    if (seqPhases.length > 0) {
      userNotes = serializeOrderNotesWithRoute("", { seqPhases });
    }

    lastSerial += 1;
    const number = `OP${String(lastSerial).padStart(4, "0")}-${year}`;

    await prisma.productionOrder.create({
      data: {
        number,
        year,
        serial: lastSerial,
        kind: ProductionOrderKind.PROYECTO,
        projectId: args.projectId,
        lampId: lamp.id,
        lampLabel: lamp.name,
        elementTypeId: et.id,
        naveId,
        naveKey: preview.naveKey,
        process: preview.process,
        hours: preview.hours > 0 ? preview.hours : null,
        notes: userNotes || null,
        lines: {
          create: [
            {
              projectId: args.projectId,
              units: preview.units,
              ral: preview.ral,
              colorHex: lamp.colorHex,
            },
          ],
        },
      },
    });
    numbers.push(number);
  }

  return { created: numbers.length, numbers, skipped };
}

export async function applySeqTransferOnConfirm(args: {
  tx: Prisma.TransactionClient;
  orderId: string;
  completedStep: number;
}): Promise<{ transferred: boolean; note?: string }> {
  const order = await args.tx.productionOrder.findUnique({
    where: { id: args.orderId },
    select: { notes: true, naveKey: true, step: true },
  });
  if (!order || order.naveKey !== "SEQ") return { transferred: false };

  const { userNotes, route } = parseOrderRouteMeta(order.notes);
  if (!detectN3ToN2Transfer({ route, completedStep: args.completedStep })) {
    return { transferred: false };
  }

  const n2 = await args.tx.nave.findFirst({
    where: { codigo: "N2", isActive: true },
    select: { id: true },
  });
  if (!n2) return { transferred: false };

  const transferNote = `[TRASPASO] N3 → N2 · ${new Date().toISOString()}`;
  const mergedUserNotes = userNotes ? `${userNotes}\n${transferNote}` : transferNote;
  const { meta } = parseOrderExecutionMeta(order.notes);
  const notesWithRoute = serializeOrderNotesWithRoute(mergedUserNotes, route);

  await args.tx.productionOrder.update({
    where: { id: args.orderId },
    data: {
      naveId: n2.id,
      notes: serializeOrderNotes(notesWithRoute, meta),
    },
  });

  return { transferred: true, note: transferNote };
}
