import { z } from "zod";

export const assignStockToProjectSchema = z.object({
  stockItemId: z.string().min(1),
  projectId: z.string().min(1),
  units: z.number().int().positive(),
  ral: z.string().min(1).optional(),
  colorHex: z.string().optional(),
});

export const cancelOrderLineSchema = z.object({
  orderId: z.string().min(1),
  lineId: z.string().min(1),
  units: z.number().int().positive().optional(),
});

export type AssignStockToProjectInput = z.infer<typeof assignStockToProjectSchema>;
export type CancelOrderLineInput = z.infer<typeof cancelOrderLineSchema>;
