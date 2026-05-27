export interface TaskLampFrameSource {
  lampFrame?: { label: string | null; frameType?: { name: string } | null } | null;
  lamp?: { frameType?: { name: string } | null } | null;
}

/** Etiqueta del bastidor asignado a la tarea (frame concreto dentro de la lámpara). */
export function getTaskLampFrameLabel(
  source: TaskLampFrameSource | null | undefined,
): string | null {
  if (!source) return null;
  return (
    source.lampFrame?.label ??
    source.lampFrame?.frameType?.name ??
    source.lamp?.frameType?.name ??
    null
  );
}
