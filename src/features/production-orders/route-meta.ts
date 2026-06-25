import { z } from "zod";

export const seqPhaseSchema = z.object({
  process: z.string().min(1),
  naveCodigo: z.string().min(1),
  sequence: z.number().int().min(0),
  hoursPerUnit: z.number().nonnegative().optional(),
  fixedHours: z.number().nonnegative().optional(),
});

export type SeqPhase = z.infer<typeof seqPhaseSchema>;

export interface OrderRouteMeta {
  seqPhases: SeqPhase[];
}

const ROUTE_META_START = "\n---ROUTE---\n";
const ROUTE_META_END = "\n---END ROUTE---\n";

export function parseOrderRouteMeta(notes: string | null): {
  userNotes: string;
  route: OrderRouteMeta | null;
} {
  if (!notes) return { userNotes: "", route: null };
  const start = notes.indexOf(ROUTE_META_START);
  if (start === -1) return { userNotes: notes, route: null };
  const end = notes.indexOf(ROUTE_META_END, start);
  if (end === -1) return { userNotes: notes.slice(0, start).trim(), route: null };
  const json = notes.slice(start + ROUTE_META_START.length, end).trim();
  let route: OrderRouteMeta | null = null;
  try {
    const parsed = JSON.parse(json) as OrderRouteMeta;
    if (Array.isArray(parsed.seqPhases)) route = parsed;
  } catch {
    route = null;
  }
  const userNotes = (notes.slice(0, start) + notes.slice(end + ROUTE_META_END.length)).trim();
  return { userNotes, route };
}

export function serializeOrderNotesWithRoute(
  userNotes: string,
  route: OrderRouteMeta | null,
): string {
  const base = userNotes.trim();
  if (!route?.seqPhases.length) return base;
  const block = `${ROUTE_META_START}${JSON.stringify(route)}${ROUTE_META_END}`;
  return base ? `${base}${block}` : block.trim();
}

export function mergeNotesWithExecAndRoute(args: {
  userNotes: string;
  execBlock?: string;
  route: OrderRouteMeta | null;
}): string {
  let notes = args.userNotes.trim();
  if (args.route?.seqPhases.length) {
    notes = serializeOrderNotesWithRoute(notes, args.route);
  }
  if (args.execBlock) {
    notes = notes ? `${notes}${args.execBlock}` : args.execBlock.trim();
  }
  return notes;
}

export function getSeqPhaseAtStep(
  route: OrderRouteMeta | null,
  step: number,
): SeqPhase | null {
  if (!route?.seqPhases.length) return null;
  const sorted = [...route.seqPhases].sort((a, b) => a.sequence - b.sequence);
  return sorted[step] ?? null;
}

export function getSeqPhaseAfterStep(
  route: OrderRouteMeta | null,
  step: number,
): SeqPhase | null {
  return getSeqPhaseAtStep(route, step + 1);
}

export function detectN3ToN2Transfer(args: {
  route: OrderRouteMeta | null;
  completedStep: number;
}): boolean {
  const current = getSeqPhaseAtStep(args.route, args.completedStep);
  const next = getSeqPhaseAfterStep(args.route, args.completedStep);
  return current?.naveCodigo === "N3" && next?.naveCodigo === "N2";
}

export function parseSeqPhasesJson(value: unknown): SeqPhase[] {
  if (!Array.isArray(value)) return [];
  const result: SeqPhase[] = [];
  for (const item of value) {
    const parsed = seqPhaseSchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
  }
  return result.sort((a, b) => a.sequence - b.sequence);
}
