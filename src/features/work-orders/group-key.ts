/** Clave de agrupación automática: mismo tipo de elemento + mismo proceso. */
export function workOrderGroupKey(task: {
  process: string;
  lampElement?: { elementType: { id: string } } | null;
  lamp?: { elementType?: { id: string } | null } | null;
}): string | null {
  const elementTypeId =
    task.lampElement?.elementType.id ?? task.lamp?.elementType?.id ?? null;
  if (!elementTypeId) return null;
  return `${elementTypeId}:${task.process}`;
}
