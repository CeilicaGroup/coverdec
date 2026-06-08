import { z } from "zod";

export const HORIZON_MODE_VALUES = [
  "WEEK",
  "MONTH",
  "ALL_PROJECTS",
  "PROJECT",
  "UNTIL_DATE",
] as const;

export type HorizonModeKind = (typeof HORIZON_MODE_VALUES)[number];

export const HORIZON_MODE_OPTIONS = [
  { value: "WEEK" as const, label: "Esta semana" },
  { value: "MONTH" as const, label: "1 mes (4 semanas)" },
  { value: "ALL_PROJECTS" as const, label: "Hasta acabar todos" },
  { value: "PROJECT" as const, label: "Hasta acabar proyecto…" },
  { value: "UNTIL_DATE" as const, label: "Hasta fecha…" },
] satisfies ReadonlyArray<{ value: HorizonModeKind; label: string }>;

const horizonModeBaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("WEEK") }),
  z.object({ kind: z.literal("MONTH") }),
  z.object({ kind: z.literal("ALL_PROJECTS") }),
  z.object({
    kind: z.literal("PROJECT"),
    projectId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("UNTIL_DATE"),
    untilIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
]);

export const planningHorizonModeSchema = horizonModeBaseSchema;

export type PlanningHorizonMode = z.infer<typeof planningHorizonModeSchema>;

export function horizonModeLabel(mode: PlanningHorizonMode): string {
  const base = HORIZON_MODE_OPTIONS.find((o) => o.value === mode.kind)?.label ?? mode.kind;
  if (mode.kind === "PROJECT") return `${base}`;
  if (mode.kind === "UNTIL_DATE") return `${base}`;
  return base;
}

export function parseHorizonModeInput(input: {
  kind: string;
  projectId?: string;
  untilIso?: string;
}): PlanningHorizonMode {
  return planningHorizonModeSchema.parse({
    kind: input.kind,
    projectId: input.projectId,
    untilIso: input.untilIso,
  });
}
