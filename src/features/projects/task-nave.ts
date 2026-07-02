import type { ElementTypology, PrismaClient } from "@/generated/prisma";

export interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

export interface NaveLabelSummary {
  label: string;
  homogeneous: boolean;
  naveId: string | null;
}

export async function getFallbackNaveId(
  db: Pick<PrismaClient, "nave">,
): Promise<string> {
  const nave = await db.nave.findFirst({
    where: { isActive: true },
    orderBy: { codigo: "asc" },
    select: { id: true },
  });
  if (!nave) throw new Error("No hay ninguna nave activa.");
  return nave.id;
}

export async function loadTypologyDefaultNaves(
  db: Pick<PrismaClient, "elementTypologyNave">,
): Promise<Map<ElementTypology, string>> {
  const rows = await db.elementTypologyNave.findMany({
    where: { defaultNaveId: { not: null } },
    select: { typology: true, defaultNaveId: true },
  });
  return new Map(
    rows
      .filter(
        (row): row is { typology: ElementTypology; defaultNaveId: string } =>
          row.defaultNaveId != null,
      )
      .map((row) => [row.typology, row.defaultNaveId]),
  );
}

export function resolveEffectiveElementTypeNaveId(args: {
  elementTypeId: string | null;
  elementTypeDefaultNaveId: string | null | undefined;
  elementTypeTypology: ElementTypology | null | undefined;
  elementTypeDefaultNaves: Map<string, string>;
  typologyDefaultNaves: Map<ElementTypology, string>;
  fallbackNaveId: string;
}): string {
  if (args.elementTypeId == null) return args.fallbackNaveId;

  const fromMap = args.elementTypeDefaultNaves.get(args.elementTypeId);
  if (fromMap) return fromMap;

  if (args.elementTypeDefaultNaveId) return args.elementTypeDefaultNaveId;

  if (args.elementTypeTypology) {
    const fromTypology = args.typologyDefaultNaves.get(args.elementTypeTypology);
    if (fromTypology) return fromTypology;
  }

  return args.fallbackNaveId;
}

export async function loadElementTypeDefaultNaves(
  db: Pick<PrismaClient, "elementType" | "elementTypologyNave" | "nave">,
): Promise<Map<string, string>> {
  const [fallbackNaveId, typologyDefaultNaves, elementTypes] = await Promise.all([
    getFallbackNaveId(db),
    loadTypologyDefaultNaves(db),
    db.elementType.findMany({
      select: { id: true, typology: true, defaultNaveId: true },
    }),
  ]);

  return new Map(
    elementTypes.map((elementType) => [
      elementType.id,
      resolveEffectiveElementTypeNaveId({
        elementTypeId: elementType.id,
        elementTypeDefaultNaveId: elementType.defaultNaveId,
        elementTypeTypology: elementType.typology,
        elementTypeDefaultNaves: new Map(),
        typologyDefaultNaves,
        fallbackNaveId,
      }),
    ]),
  );
}

export async function loadTaskNaveContext(
  db: Pick<PrismaClient, "nave" | "elementType" | "elementTypologyNave">,
): Promise<{
  fallbackNaveId: string;
  typologyDefaultNaves: Map<ElementTypology, string>;
  elementTypeDefaultNaves: Map<string, string>;
}> {
  const [fallbackNaveId, typologyDefaultNaves, elementTypeDefaultNaves] =
    await Promise.all([
      getFallbackNaveId(db),
      loadTypologyDefaultNaves(db),
      loadElementTypeDefaultNaves(db),
    ]);
  return { fallbackNaveId, typologyDefaultNaves, elementTypeDefaultNaves };
}

export function resolveNaveForElementType(
  elementTypeId: string | null,
  elementTypeDefaultNaves: Map<string, string>,
  fallbackNaveId: string,
): string {
  if (elementTypeId == null) return fallbackNaveId;
  return elementTypeDefaultNaves.get(elementTypeId) ?? fallbackNaveId;
}

/** Nave de catálogo para un proceso: override del proceso o herencia del elemento. */
export function resolveNaveForElementProcess(args: {
  processNaveId: string | null | undefined;
  elementTypeId: string | null;
  elementTypeDefaultNaves: Map<string, string>;
  fallbackNaveId: string;
}): string {
  if (args.processNaveId) return args.processNaveId;
  return resolveNaveForElementType(
    args.elementTypeId,
    args.elementTypeDefaultNaves,
    args.fallbackNaveId,
  );
}

export function buildCatalogNaveByProcess(args: {
  elementTypeId: string;
  processes: Array<{ process: string; naveId: string | null }>;
  elementTypeDefaultNaves: Map<string, string>;
  fallbackNaveId: string;
}): Map<string, string> {
  return new Map(
    args.processes.map((row) => [
      row.process,
      resolveNaveForElementProcess({
        processNaveId: row.naveId,
        elementTypeId: args.elementTypeId,
        elementTypeDefaultNaves: args.elementTypeDefaultNaves,
        fallbackNaveId: args.fallbackNaveId,
      }),
    ]),
  );
}

export function formatNaveLabel(
  nave: NaveSummary | undefined,
  naveId: string,
): string {
  return nave ? `${nave.codigo} · ${nave.nombre}` : naveId;
}

export function isCustomNaveAssignment(
  naveId: string,
  catalogNaveId: string | null | undefined,
): boolean {
  if (!catalogNaveId) return false;
  return naveId !== catalogNaveId;
}

export type NaveAssignmentKind = "default" | "custom" | "mixed" | "unknown";

export function describeNaveAssignment(args: {
  naveIds: string[];
  catalogNaveId?: string | null | undefined;
  /** @deprecated Use catalogNaveId */
  elementTypeDefaultNaveId?: string | null | undefined;
}): NaveAssignmentKind {
  const catalogNaveId = args.catalogNaveId ?? args.elementTypeDefaultNaveId;
  const unique = [...new Set(args.naveIds)];
  if (unique.length === 0) return "unknown";
  if (unique.length > 1) return "mixed";
  if (!catalogNaveId) return "unknown";
  return unique[0] === catalogNaveId ? "default" : "custom";
}

export function summarizeNaveIds(
  naveIds: string[],
  navesById: Map<string, NaveSummary>,
): NaveLabelSummary {
  if (naveIds.length === 0) {
    return { label: "—", homogeneous: true, naveId: null };
  }

  const unique = [...new Set(naveIds)];
  if (unique.length === 1) {
    const naveId = unique[0]!;
    return {
      label: formatNaveLabel(navesById.get(naveId), naveId),
      homogeneous: true,
      naveId,
    };
  }

  return { label: "Mixto", homogeneous: false, naveId: null };
}

/** Naves distintas por proyecto (todas las tareas / procesos). */
export function buildProjectNavesByProjectId(
  rows: { projectId: string; nave: NaveSummary }[],
): Map<string, NaveSummary[]> {
  const byProject = new Map<string, Map<string, NaveSummary>>();
  for (const row of rows) {
    const naves = byProject.get(row.projectId) ?? new Map<string, NaveSummary>();
    naves.set(row.nave.id, row.nave);
    byProject.set(row.projectId, naves);
  }

  const result = new Map<string, NaveSummary[]>();
  for (const [projectId, naves] of byProject) {
    result.set(
      projectId,
      [...naves.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)),
    );
  }
  return result;
}

export function formatProjectNavesColumn(naves: NaveSummary[] | undefined): string {
  if (!naves?.length) return "—";
  if (naves.length === 1) {
    return formatNaveLabel(naves[0]!, naves[0]!.id);
  }
  return naves.map((n) => n.codigo).join(" · ");
}

export const MANUAL_ELEMENT_KEY = "__sin_elemento__";

export function elementTypeIdFromGroupKey(groupKey: string): string | null {
  return groupKey === MANUAL_ELEMENT_KEY ? null : groupKey;
}

export function elementTaskScopeWhere(args: {
  lampId: string;
  elementTypeId: string | null;
  process?: string;
}) {
  return {
    lampId: args.lampId,
    ...(args.process ? { process: args.process } : {}),
    ...(args.elementTypeId === null
      ? { lampElementId: null }
      : { lampElement: { elementTypeId: args.elementTypeId } }),
  };
}
