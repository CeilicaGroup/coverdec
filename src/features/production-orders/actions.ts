"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { runAuditedMutation } from "@/lib/server-action";
import { childLogger } from "@/lib/logger";
import { ProductionOrderKind, ProductionOrderStatus, Role } from "@/generated/prisma";
import { getCoordinatedPlanningNaveIds } from "@/features/planning/coordinated-naves";
import { isPrimerProcess } from "@/features/production-orders/grouping-rules";
import {
  assertStockOrderCanStartPaint,
  createStockItemsFromPrimedOrder,
} from "@/features/stock/create-from-order";
import {
  assertOrderTransition,
  finishProductionOrderTx,
  loadProductionOrderForExecution,
  parseOrderExecutionMeta,
  serializeOrderNotes,
} from "./execution";
import {
  generateWorkOrdersFromPlanning,
  previewWorkOrdersFromPlanning,
} from "./group-from-planning";
import {
  assertCanExecuteProductionOrder,
} from "./permissions";
import {
  applySeqTransferOnConfirm,
  createProductionOrdersFromProject,
  previewProductionOrdersFromProject,
} from "./create-from-project";
import {
  createProductionOrderSchema,
  normalizeCreateProductionOrderLines,
} from "./schema";

const log = childLogger({ module: "production-orders.actions" });

const planningWeekSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  week: z.number().int().min(1).max(53),
});

const orderIdSchema = z.object({ orderId: z.string().min(1) });

const pauseOrderSchema = orderIdSchema.extend({
  reason: z.string().min(1).max(500),
});

const confirmStepSchema = orderIdSchema.extend({
  stepHours: z.number().positive(),
  completedUnits: z.number().int().min(0).optional(),
  lineId: z.string().optional(),
});

const finishOrderSchema = orderIdSchema.extend({
  actualHours: z.number().positive().optional(),
});

const generateSelectedSchema = planningWeekSchema.extend({
  batchKeys: z.array(z.string().min(1)).min(1),
});

function revalidateOrdenesPaths(orderId?: string) {
  revalidatePath("/dashboard/ordenes");
  revalidatePath("/dashboard/planta");
  revalidatePath("/dashboard/almacen");
  revalidatePath("/dashboard/proyectos");
  revalidatePath("/dashboard/horas");
  revalidatePath("/dashboard/semana");
  if (orderId) revalidatePath(`/dashboard/ordenes/${orderId}`);
}

export async function startProductionOrderAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.startProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      const { orderId } = orderIdSchema.parse(input);
      await assertCanExecuteProductionOrder(ctx, orderId, "start");
      const order = await loadProductionOrderForExecution(orderId);
      assertOrderTransition(order.status, [ProductionOrderStatus.PEND]);
      assertStockOrderCanStartPaint(order);
      await prisma.productionOrder.update({
        where: { id: orderId },
        data: {
          status: ProductionOrderStatus.CURSO,
          scheduledAt: order.scheduledAt ?? new Date(),
        },
      });
      revalidateOrdenesPaths(orderId);
      return { ok: true as const };
    },
    (result) => ({ summary: "Iniciar orden de producción", entityType: "ProductionOrder" }),
  );
}

export async function pauseProductionOrderAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.pauseProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      const data = pauseOrderSchema.parse(input);
      await assertCanExecuteProductionOrder(ctx, data.orderId, "pause");
      const order = await loadProductionOrderForExecution(data.orderId);
      assertOrderTransition(order.status, [
        ProductionOrderStatus.CURSO,
        ProductionOrderStatus.MULTI,
      ]);
      const { userNotes } = parseOrderExecutionMeta(order.notes);
      const pauseNote = `[Pausa] ${data.reason.trim()}`;
      const mergedNotes = userNotes ? `${userNotes}\n${pauseNote}` : pauseNote;
      const { meta } = parseOrderExecutionMeta(order.notes);
      await prisma.productionOrder.update({
        where: { id: data.orderId },
        data: {
          status: ProductionOrderStatus.INT,
          notes: serializeOrderNotes(mergedNotes, meta),
        },
      });
      revalidateOrdenesPaths(data.orderId);
      return { ok: true as const };
    },
    { summary: "Pausar orden de producción", entityType: "ProductionOrder" },
  );
}

export async function resumeProductionOrderAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.resumeProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      const { orderId } = orderIdSchema.parse(input);
      await assertCanExecuteProductionOrder(ctx, orderId, "resume");
      const order = await loadProductionOrderForExecution(orderId);
      assertOrderTransition(order.status, [ProductionOrderStatus.INT]);
      await prisma.productionOrder.update({
        where: { id: orderId },
        data: { status: ProductionOrderStatus.CURSO },
      });
      revalidateOrdenesPaths(orderId);
      return { ok: true as const };
    },
    { summary: "Reanudar orden de producción", entityType: "ProductionOrder" },
  );
}

export async function confirmProductionOrderStepAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.confirmProductionOrderStep",
    async () => {
      const ctx = await requireDashboardContext();
      const data = confirmStepSchema.parse(input);
      await assertCanExecuteProductionOrder(ctx, data.orderId, "confirm");
      const order = await loadProductionOrderForExecution(data.orderId);
      assertOrderTransition(order.status, [
        ProductionOrderStatus.CURSO,
        ProductionOrderStatus.MULTI,
      ]);
      const { userNotes, meta } = parseOrderExecutionMeta(order.notes);
      const newMeta = { actualHours: meta.actualHours + data.stepHours };
      const isStockPrimer =
        order.kind === ProductionOrderKind.STOCK &&
        Boolean(order.process && isPrimerProcess(order.process));

      await prisma.$transaction(async (tx) => {
        if (data.lineId != null && data.completedUnits != null) {
          const line = order.lines.find((l) => l.id === data.lineId);
          if (!line) throw new Error("Línea no encontrada.");
          const nextCompleted = Math.min(
            line.units,
            line.completedUnits + data.completedUnits,
          );
          await tx.productionOrderLine.update({
            where: { id: data.lineId },
            data: { completedUnits: nextCompleted },
          });
        }

        const updatedNotes = serializeOrderNotes(userNotes, newMeta);
        await tx.productionOrder.update({
          where: { id: data.orderId },
          data: {
            status: isStockPrimer
              ? ProductionOrderStatus.IMPRIMADO
              : ProductionOrderStatus.MULTI,
            step: order.step + 1,
            notes: updatedNotes,
          },
        });

        await applySeqTransferOnConfirm({
          tx,
          orderId: data.orderId,
          completedStep: order.step,
        });

        if (isStockPrimer) {
          await createStockItemsFromPrimedOrder(tx, {
            id: order.id,
            kind: order.kind,
            process: order.process,
            elementTypeId: order.elementTypeId,
            lampLabel: order.lampLabel,
            notes: updatedNotes,
            lines: order.lines.map((l) => ({
              id: l.id,
              units: l.units,
              completedUnits: l.completedUnits,
              lineStatus: l.lineStatus,
              projectId: l.projectId,
              ral: l.ral,
              colorHex: l.colorHex,
            })),
          });
        }
      });
      revalidateOrdenesPaths(data.orderId);
      return { ok: true as const };
    },
    { summary: "Confirmar paso de orden de producción", entityType: "ProductionOrder" },
  );
}

export async function finishProductionOrderAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.finishProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      const data = finishOrderSchema.parse(input);
      await assertCanExecuteProductionOrder(ctx, data.orderId, "finish");
      const result = await prisma.$transaction(async (tx) =>
        finishProductionOrderTx(tx, {
          orderId: data.orderId,
          userId: ctx.userId,
          actualHours: data.actualHours ?? 0,
        }),
      );
      log.info({ orderId: data.orderId, ...result }, "production order finished");
      revalidateOrdenesPaths(data.orderId);
      return result;
    },
    (result) => ({
      summary: "Finalizar orden de producción",
      entityType: "ProductionOrder",
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function previewWorkOrdersFromPlanningAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.previewWorkOrdersFromPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = planningWeekSchema.parse(input);
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      const batches = await previewWorkOrdersFromPlanning({
        naveIds,
        year: data.year,
        week: data.week,
      });
      return { batches };
    },
    { summary: "Vista previa de OT desde planning" },
  );
}

export async function generateWorkOrdersFromPlanningAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.generateWorkOrdersFromPlanning",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = planningWeekSchema.parse(input);
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      const result = await generateWorkOrdersFromPlanning({
        naveIds,
        year: data.year,
        week: data.week,
      });
      log.info(result, "work orders generated from planning");
      revalidatePath("/dashboard/ordenes");
      return result;
    },
    (result) => ({
      summary: `Generar ${result.created} OT desde planning`,
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function generateSelectedWorkOrdersAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.generateSelectedWorkOrders",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = generateSelectedSchema.parse(input);
      const naveIds = await getCoordinatedPlanningNaveIds(ctx);
      const result = await generateWorkOrdersFromPlanning({
        naveIds,
        year: data.year,
        week: data.week,
        batchKeys: data.batchKeys,
      });
      log.info(result, "selected work orders generated");
      revalidatePath("/dashboard/ordenes");
      return result;
    },
    (result) => ({
      summary: `Generar ${result.created} OT seleccionadas`,
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function previewProductionOrdersFromProjectAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.previewProductionOrdersFromProject",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = z
        .object({
          projectId: z.string().min(1),
          lampIds: z.array(z.string()).optional(),
        })
        .parse(input);
      return previewProductionOrdersFromProject(data);
    },
    { summary: "Vista previa OPs desde proyecto" },
  );
}

export async function createProductionOrdersFromProjectAction(input: unknown) {
  return runAuditedMutation(
    "production-orders.createProductionOrdersFromProject",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = z
        .object({
          projectId: z.string().min(1),
          lampIds: z.array(z.string()).optional(),
        })
        .parse(input);
      const result = await createProductionOrdersFromProject(data);
      log.info(result, "production orders created from project");
      revalidateOrdenesPaths();
      revalidatePath(`/dashboard/proyectos/${data.projectId}`);
      return result;
    },
    (result) => ({
      summary: `Generar ${result.created} OP desde proyecto`,
      metadata: result as unknown as Record<string, unknown>,
    }),
  );
}

export async function createProductionOrder(
  input: Parameters<typeof createProductionOrderSchema.parse>[0],
) {
  return runAuditedMutation(
    "production-orders.createProductionOrder",
    async () => {
      const ctx = await requireDashboardContext();
      requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
      const data = createProductionOrderSchema.parse(input);
      const kind = data.kind ?? ProductionOrderKind.PROYECTO;
      const lines = normalizeCreateProductionOrderLines(data);

      if (lines.length === 0) {
        throw new Error("Indica al menos una línea de destino (proyecto y unidades)");
      }

      const year = new Date().getUTCFullYear();
      const last = await prisma.productionOrder.findFirst({
        where: { year },
        orderBy: { serial: "desc" },
      });
      const serial = (last?.serial ?? 0) + 1;
      const number = `OP${String(serial).padStart(4, "0")}-${year}`;
      const headerProjectId =
        kind === ProductionOrderKind.STOCK
          ? null
          : (data.projectId ?? lines.find((l) => l.projectId)?.projectId);

      const order = await prisma.productionOrder.create({
        data: {
          number,
          year,
          serial,
          kind,
          projectId: headerProjectId,
          lampLabel: data.lampLabel,
          process: data.process,
          hours: data.hours,
          scheduledAt: data.scheduledAt ? new Date(data.scheduledAt) : undefined,
          naveId: data.naveId,
          elementTypeId: data.elementTypeId,
          notes: data.notes,
          lines: {
            create: lines.map((line) => ({
              projectId: line.projectId,
              clientLabel: line.clientLabel,
              units: line.units,
              ral: line.ral,
              colorHex: line.colorHex,
            })),
          },
        },
        include: { lines: true },
      });

      log.info(
        { id: order.id, number, lineCount: order.lines.length },
        "production order created",
      );
      revalidatePath("/dashboard/ordenes");
      return { id: order.id, number };
    },
    (result) => ({
      summary: `Crear orden de producción ${result.number}`,
      entityType: "ProductionOrder",
      entityId: result.id,
      metadata: input as Record<string, unknown>,
    }),
  );
}
