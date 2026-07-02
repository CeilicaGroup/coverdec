import { ProjectKind } from "@/generated/prisma";

export const PROJECT_KINDS = [
  ProjectKind.PRODUCCION,
  ProjectKind.PROTOTIPO,
  ProjectKind.PRESUPUESTO,
] as const;

export const PROJECT_KIND_LABELS: Record<ProjectKind, string> = {
  [ProjectKind.PRODUCCION]: "Producción",
  [ProjectKind.PROTOTIPO]: "Prototipo",
  [ProjectKind.PRESUPUESTO]: "Presupuesto",
  [ProjectKind.STOCK]: "Stock",
  [ProjectKind.IMPREVISTAS]: "Imprevistas",
};

export const PROJECT_KIND_BADGE_CLASS: Record<ProjectKind, string> = {
  [ProjectKind.PRODUCCION]: "bg-muted text-muted-foreground",
  [ProjectKind.PROTOTIPO]: "bg-violet-50 text-violet-700",
  [ProjectKind.PRESUPUESTO]: "bg-sky-50 text-sky-700",
  [ProjectKind.STOCK]: "bg-amber-50 text-amber-800",
  [ProjectKind.IMPREVISTAS]: "bg-pink-50 text-pink-800",
};

export function isManualEstimateProjectKind(kind: ProjectKind): boolean {
  return kind === ProjectKind.PROTOTIPO || kind === ProjectKind.PRESUPUESTO;
}

export function isStockProjectKind(kind: ProjectKind): boolean {
  return kind === ProjectKind.STOCK;
}

export function isImprevistasProjectKind(kind: ProjectKind): boolean {
  return kind === ProjectKind.IMPREVISTAS;
}

export const INTERNAL_PROJECT_KINDS = [
  ProjectKind.STOCK,
  ProjectKind.IMPREVISTAS,
] as const;

export function isInternalProjectKind(kind: ProjectKind): boolean {
  return kind === ProjectKind.STOCK || kind === ProjectKind.IMPREVISTAS;
}

export function internalProjectDisplayLabel(
  kind: ProjectKind | string | undefined,
  name: string,
): string {
  if (kind === ProjectKind.STOCK || kind === "STOCK") return "Stock";
  if (kind === ProjectKind.IMPREVISTAS || kind === "IMPREVISTAS") {
    return "Imprevistas";
  }
  return name;
}
