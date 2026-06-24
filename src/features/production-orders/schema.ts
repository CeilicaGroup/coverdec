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

export const createProductionOrderSchema = z.object({
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
});

export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;
