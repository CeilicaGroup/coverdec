export interface TaskLampElementSource {
  lampElement?: { label: string | null; elementType?: { name: string } | null } | null;
  lamp?: { elementType?: { name: string } | null } | null;
}

/** Etiqueta del elemento asignado a la tarea (unidad física dentro de la lámpara). */
export function getTaskLampElementLabel(
  source: TaskLampElementSource | null | undefined,
): string | null {
  if (!source) return null;
  return (
    source.lampElement?.label ??
    source.lampElement?.elementType?.name ??
    source.lamp?.elementType?.name ??
    null
  );
}
