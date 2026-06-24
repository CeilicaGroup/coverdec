const PAINT_PROCESS_CODES = new Set(["PINTURA", "PINT"]);
const PRIMER_PROCESS_CODES = new Set(["IMPRIMACION", "IMPRIM"]);

export function isPaintProcess(process: string): boolean {
  return PAINT_PROCESS_CODES.has(process.toUpperCase());
}

export function isPrimerProcess(process: string): boolean {
  return PRIMER_PROCESS_CODES.has(process.toUpperCase());
}

const RAL_REGEX = /RAL[\s-]*(\d{4})/i;

/** Resuelve RAL desde lámpara (campo o texto en name/code/notes). */
export function resolveRalFromLamp(lamp: {
  ral?: string | null;
  colorHex?: string | null;
  notes?: string | null;
  name?: string | null;
  code?: string | null;
}): { ral: string | null; colorHex: string | null } {
  if (lamp.ral?.trim()) {
    return { ral: lamp.ral.trim(), colorHex: lamp.colorHex ?? null };
  }
  for (const src of [lamp.notes, lamp.name, lamp.code]) {
    if (!src) continue;
    const match = src.match(RAL_REGEX);
    if (match) return { ral: match[1]!, colorHex: lamp.colorHex ?? null };
  }
  return { ral: null, colorHex: lamp.colorHex ?? null };
}

export function buildProcessBatchSuffix(args: {
  process: string;
  elementTypeId: string | null;
  ral: string | null;
  taskId: string;
  separateWorkOrder: boolean;
}): string {
  if (isPrimerProcess(args.process)) {
    // Imprimación: un solo lote por tipo de elemento (nunca dividir por proyecto).
    return `elem:${args.elementTypeId ?? "none"}`;
  }
  if (isPaintProcess(args.process)) {
    // Pintura: sub-OP por RAL (+ tipo de elemento).
    const ralKey = args.ral ?? `task:${args.taskId}`;
    return `ral:${ralKey}|elem:${args.elementTypeId ?? "none"}`;
  }
  if (args.separateWorkOrder) {
    return `task:${args.taskId}`;
  }
  return `elem:${args.elementTypeId ?? "none"}`;
}
