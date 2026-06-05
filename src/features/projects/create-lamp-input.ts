import { z } from "zod";
import { ElementTypology, ProjectKind } from "@/generated/prisma";
import { isManualEstimateProjectKind } from "@/lib/project-kind";

export const lampElementInputSchema = z.object({
  typology: z.nativeEnum(ElementTypology),
  elementTypeId: z.string().min(1),
  surfaceM2: z.number().positive(),
  units: z.number().int().positive(),
});

export const createLampInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  elements: z.array(lampElementInputSchema).optional(),
  estimatedHours: z.number().positive().optional(),
  confirmSimilarName: z.boolean().optional(),
});

export type CreateLampInput = z.infer<typeof createLampInputSchema>;
export type CreateLampMode = "catalog" | "manual";

export function resolveCreateLampMode(
  kind: ProjectKind,
  data: CreateLampInput,
): CreateLampMode {
  const hasElements = Boolean(data.elements?.length);
  const hasHours = data.estimatedHours != null;

  if (hasElements && hasHours) {
    throw new Error("Usa elementos o horas manuales, no ambos a la vez.");
  }

  if (isManualEstimateProjectKind(kind)) {
    if (hasElements) return "catalog";
    if (hasHours) return "manual";
    throw new Error("Indica elementos o un total de horas estimadas.");
  }

  if (hasHours) {
    throw new Error(
      "Las horas manuales solo están disponibles en prototipos y presupuestos.",
    );
  }
  if (!hasElements) {
    throw new Error("Añade al menos un elemento con medida.");
  }

  return "catalog";
}
