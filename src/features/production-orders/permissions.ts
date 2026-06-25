import { ProductionOrderStatus, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { DashboardContext } from "@/lib/context";

export type OrderExecutionAction =
  | "start"
  | "pause"
  | "resume"
  | "confirm"
  | "finish";

const OPERARIO_ACTIONS = new Set<OrderExecutionAction>([
  "start",
  "pause",
  "resume",
  "confirm",
]);

export async function assertCanExecuteProductionOrder(
  ctx: DashboardContext,
  orderId: string,
  action: OrderExecutionAction,
): Promise<void> {
  if (ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION) return;

  if (ctx.role !== Role.OPERARIO) {
    throw new Error("No tienes permisos para ejecutar órdenes de producción.");
  }

  if (!OPERARIO_ACTIONS.has(action)) {
    throw new Error("Solo jefe de producción puede finalizar la OP.");
  }

  if (!ctx.personId) {
    throw new Error("Tu usuario no está vinculado a una persona.");
  }

  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    select: {
      naveId: true,
      process: true,
      status: true,
    },
  });
  if (!order) throw new Error("Orden de producción no encontrada.");

  if (order.status === ProductionOrderStatus.CERR) {
    throw new Error("La OP ya está cerrada.");
  }

  if (order.status === ProductionOrderStatus.IMPRIMADO) {
    throw new Error("La OP está en almacén (imprimada); no admite más ejecución.");
  }

  if (order.naveId && !ctx.naveIds.includes(order.naveId)) {
    throw new Error("No tienes acceso a OPs de esa nave.");
  }

  if (!order.process) return;

  const person = await prisma.person.findUnique({
    where: { id: ctx.personId },
    select: {
      specialties: { select: { process: true, isPrimary: true } },
    },
  });
  const processes = person?.specialties.map((s) => s.process) ?? [];
  if (processes.length > 0 && !processes.includes(order.process)) {
    throw new Error("Esta OP no corresponde a tus especialidades.");
  }
}

export function canManageProductionOrders(role: Role): boolean {
  return role === Role.ADMIN || role === Role.JEFE_PRODUCCION;
}

export function canExecuteProductionOrders(role: Role): boolean {
  return (
    role === Role.ADMIN ||
    role === Role.JEFE_PRODUCCION ||
    role === Role.OPERARIO
  );
}
