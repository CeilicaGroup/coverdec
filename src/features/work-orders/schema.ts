import { z } from "zod";

export const workOrderTaskIdsSchema = z
  .array(z.string().min(1))
  .min(1, "Una OT debe incluir al menos 1 tarea.");

export const createWorkOrderSchema = z.object({
  taskIds: workOrderTaskIdsSchema,
  notes: z.string().max(2000).optional(),
});

export const updateWorkOrderSchema = z.object({
  id: z.string().min(1),
  taskIds: workOrderTaskIdsSchema.optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const splitWorkOrderSchema = z.object({
  id: z.string().min(1),
  taskIds: workOrderTaskIdsSchema,
  notes: z.string().max(2000).nullable().optional(),
});

export const updateWorkOrderAlertThresholdsSchema = z.object({
  maxPendingHours: z.number().int().min(1).max(500),
  maxTasks: z.number().int().min(1).max(500),
});

export const deleteWorkOrderSchema = z.object({
  id: z.string().min(1),
});
