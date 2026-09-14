export type ProjectLifecycleStatus = "PRODUCCION" | "ALMACEN";

export function deriveProjectLifecycleStatus(
  isInWarehouse: boolean,
): ProjectLifecycleStatus {
  return isInWarehouse ? "ALMACEN" : "PRODUCCION";
}

export const PROJECT_LIFECYCLE_STATUS_LABELS: Record<
  ProjectLifecycleStatus,
  string
> = {
  PRODUCCION: "Producción",
  ALMACEN: "Almacén",
};

export const PROJECT_LIFECYCLE_STATUS_BADGE_CLASS: Record<
  ProjectLifecycleStatus,
  string
> = {
  PRODUCCION: "bg-muted text-muted-foreground",
  ALMACEN: "bg-amber-50 text-amber-800",
};

export function isProjectFinished(tasks: { isCompleted: boolean }[]): boolean {
  return tasks.length > 0 && tasks.every((task) => task.isCompleted);
}
