import { NotificationType } from "@/generated/prisma";
import { notificationPayloadSchema } from "./types";

export interface NotificationAction {
  href: string;
  label: string;
}

export interface NotificationLinkContext {
  projectId?: string | null;
  planningId?: string | null;
  /** Lunes de la semana del planning (YYYY-MM-DD). */
  planningWeekIso?: string | null;
}

function weekQuery(weekIso?: string | null): string {
  if (!weekIso) return "";
  return `?week=${encodeURIComponent(weekIso)}`;
}

function safeParsePayload<T extends NotificationType>(
  type: T,
  payload: unknown,
): ReturnType<(typeof notificationPayloadSchema)[T]["parse"]> | null {
  try {
    return notificationPayloadSchema[type].parse(payload) as ReturnType<
      (typeof notificationPayloadSchema)[T]["parse"]
    >;
  } catch {
    return null;
  }
}

export function resolveNotificationAction(
  type: NotificationType,
  payload: unknown,
  ctx: NotificationLinkContext,
): NotificationAction | null {
  switch (type) {
    case NotificationType.TASK_TIME_DEVIATION_FROM_CATALOG: {
      const p = safeParsePayload(type, payload);
      if (!p) {
        return {
          href: "/dashboard/desviaciones-tiempos",
          label: "Ver desviaciones",
        };
      }
      const params = new URLSearchParams({
        elementTypeId: p.elementTypeId,
        process: p.process,
      });
      return {
        href: `/dashboard/desviaciones-tiempos?${params}`,
        label: `Ver ${p.frameTypeCode} · ${p.process}`,
      };
    }
    case NotificationType.PROJECT_SLIPPING: {
      const p = safeParsePayload(type, payload);
      const projectId = p?.projectId ?? ctx.projectId;
      if (!projectId) return { href: "/dashboard/proyectos", label: "Ver proyectos" };
      return {
        href: `/dashboard/proyectos/${projectId}`,
        label: "Ver proyecto",
      };
    }
    case NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION:
      return {
        href: `/dashboard/semana${weekQuery(ctx.planningWeekIso)}`,
        label: "Ver planning semana",
      };
    case NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE: {
      const p = safeParsePayload(type, payload);
      const firstProjectId = p?.projectIds?.[0] ?? ctx.projectId;
      if (firstProjectId) {
        return {
          href: `/dashboard/proyectos/${firstProjectId}`,
          label: "Ver proyecto en riesgo",
        };
      }
      return {
        href: `/dashboard/proyecto${weekQuery(ctx.planningWeekIso)}`,
        label: "Ver planning por proyecto",
      };
    }
    case NotificationType.ASSIGNED_TASKS_NOT_LOGGED:
      return {
        href: `/dashboard/persona${weekQuery(ctx.planningWeekIso)}`,
        label: "Ver planning por persona",
      };
    case NotificationType.ATTENDANCE_OUTSIDE_WORK_WINDOW:
    case NotificationType.ATTENDANCE_OPEN_TOO_LONG:
    case NotificationType.ATTENDANCE_INCOMPLETE_DAY:
    case NotificationType.ATTENDANCE_MISSING_WORKDAY:
      return {
        href: "/dashboard/fichaje-diario",
        label: "Ir a fichaje diario",
      };
    case NotificationType.TASK_HOURS_EXCEEDED: {
      const p = safeParsePayload(type, payload);
      const projectId = p?.projectId ?? ctx.projectId;
      if (projectId) {
        return {
          href: `/dashboard/proyectos/${projectId}`,
          label: "Ver tarea en proyecto",
        };
      }
      return {
        href: `/dashboard/proyecto${weekQuery(ctx.planningWeekIso)}`,
        label: "Ver planning por proyecto",
      };
    }
    case NotificationType.DELIVERY_FAILED:
      return {
        href: "/dashboard/admin/usuarios",
        label: "Configurar alertas",
      };
    default:
      return null;
  }
}
