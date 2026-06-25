import { z } from "zod";
import {
  ProductionOrderKind,
  ProductionOrderLineStatus,
  ProductionOrderStatus,
} from "@/generated/prisma";

export const productionOrderKindSchema = z.nativeEnum(ProductionOrderKind);
export const productionOrderStatusSchema = z.nativeEnum(ProductionOrderStatus);
export const productionOrderLineStatusSchema = z.nativeEnum(
  ProductionOrderLineStatus,
);

export const productionOrderLineInputSchema = z.object({
  projectId: z.string().min(1).optional(),
  clientLabel: z.string().optional(),
  units: z.number().int().positive(),
  ral: z.string().optional(),
  colorHex: z.string().optional(),
});

export const createProductionOrderSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    lampLabel: z.string().optional(),
    process: z.string().min(1).optional(),
    hours: z.number().positive().optional(),
    scheduledAt: z.string().optional(),
    notes: z.string().optional(),
    kind: productionOrderKindSchema.optional(),
    naveId: z.string().optional(),
    elementTypeId: z.string().optional(),
    lines: z.array(productionOrderLineInputSchema).min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const kind = data.kind ?? ProductionOrderKind.PROYECTO;

    if (kind === ProductionOrderKind.STOCK) {
      if (data.projectId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Las OP de stock no pueden tener proyecto en cabecera.",
          path: ["projectId"],
        });
      }
      if (!data.elementTypeId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Indica el tipo de elemento para la OP de stock.",
          path: ["elementTypeId"],
        });
      }
      const lines = data.lines ?? [];
      if (lines.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Indica al menos una línea con unidades para stock.",
          path: ["lines"],
        });
      }
      for (const [index, line] of lines.entries()) {
        if (line.projectId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Las líneas de stock no pueden tener proyecto.",
            path: ["lines", index, "projectId"],
          });
        }
        if (line.ral?.trim() || line.colorHex?.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Las OP de stock no llevan RAL hasta la asignación a proyecto.",
            path: ["lines", index, "ral"],
          });
        }
      }
      return;
    }

    const hasProject =
      Boolean(data.projectId?.trim()) ||
      (data.lines?.some((l) => Boolean(l.projectId?.trim())) ?? false);
    if (!hasProject) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Indica al menos una línea de destino (proyecto y unidades).",
        path: ["projectId"],
      });
    }
  });

export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;

export function normalizeCreateProductionOrderLines(
  data: CreateProductionOrderInput,
): Array<{
  projectId?: string;
  clientLabel?: string;
  units: number;
  ral?: string;
  colorHex?: string;
}> {
  const kind = data.kind ?? ProductionOrderKind.PROYECTO;

  if (kind === ProductionOrderKind.STOCK) {
    const stockLines = data.lines ?? [{ units: 1 }];
    return stockLines.map((line) => ({
      clientLabel: "STOCK",
      units: line.units,
    }));
  }

  if (data.lines?.length) {
    return data.lines.map((line) => ({
      projectId: line.projectId ?? data.projectId,
      clientLabel: line.clientLabel,
      units: line.units,
      ral: line.ral,
      colorHex: line.colorHex,
    }));
  }

  if (data.projectId) {
    return [{ projectId: data.projectId, units: 1 }];
  }

  return [];
}
