/** Cadena de precedencia: un elemento físico, o la lámpara entera si es manual. */
export function taskChainKey(task: {
  lampId: string;
  lampElementId?: string | null;
}): string {
  return task.lampElementId ?? task.lampId;
}
