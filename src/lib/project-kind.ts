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
};

export const PROJECT_KIND_BADGE_CLASS: Record<ProjectKind, string> = {
  [ProjectKind.PRODUCCION]: "bg-muted text-muted-foreground",
  [ProjectKind.PROTOTIPO]: "bg-violet-50 text-violet-700",
  [ProjectKind.PRESUPUESTO]: "bg-sky-50 text-sky-700",
};

export function isManualEstimateProjectKind(kind: ProjectKind): boolean {
  return kind === ProjectKind.PROTOTIPO || kind === ProjectKind.PRESUPUESTO;
}
