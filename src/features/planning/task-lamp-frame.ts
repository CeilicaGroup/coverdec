import type { ElementTypology } from "@/generated/prisma";

export const taskLampElementVisualSelect = {
  id: true,
  label: true,
  elementTypeId: true,
  elementType: { select: { id: true, name: true, typology: true } },
} as const;

export const lampElementTypeVisualSelect = {
  id: true,
  name: true,
  typology: true,
} as const;

export interface TaskLampElementSource {
  lampElement?: {
    id?: string;
    label: string | null;
    elementTypeId?: string;
    elementType?: { id?: string; name: string; typology?: ElementTypology } | null;
  } | null;
  lamp?: {
    elementTypeId?: string | null;
    elementType?: { id?: string; name: string; typology?: ElementTypology } | null;
  } | null;
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

export function getTaskLampElementVisualProps(
  source: TaskLampElementSource | null | undefined,
) {
  if (!source) {
    return {
      label: null as string | null,
      elementTypeId: null as string | null,
      typology: undefined as ElementTypology | undefined,
    };
  }

  const elementTypeId =
    source.lampElement?.elementTypeId ??
    source.lampElement?.elementType?.id ??
    source.lamp?.elementTypeId ??
    source.lamp?.elementType?.id ??
    null;

  return {
    label: getTaskLampElementLabel(source),
    elementTypeId,
    typology:
      source.lampElement?.elementType?.typology ??
      source.lamp?.elementType?.typology,
  };
}
