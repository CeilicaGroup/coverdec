import { NotificationType } from "@/generated/prisma";

/** Tipos que el admin puede configurar por usuario (excluye fallos de envío del sistema). */
export const CONFIGURABLE_NOTIFICATION_TYPES = Object.values(NotificationType).filter(
  (t) => t !== NotificationType.DELIVERY_FAILED,
) satisfies NotificationType[];
