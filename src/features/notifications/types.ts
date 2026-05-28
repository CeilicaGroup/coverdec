import { z } from "zod";
import { NotificationType } from "@/generated/prisma";

export const notificationTypeMeta = {
  [NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION]: {
    label: "Plan publicado con ocupación < 100%",
  },
  [NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE]: {
    label: "Plan publicado con proyectos fuera de plazo",
  },
  [NotificationType.TASK_HOURS_EXCEEDED]: {
    label: "Tareas con horas por encima de lo estimado",
  },
  [NotificationType.PROJECT_SLIPPING]: {
    label: "Proyectos que se alargan más de lo previsto",
  },
  [NotificationType.ASSIGNED_TASKS_NOT_LOGGED]: {
    label: "Tareas asignadas sin partes de horas",
  },
  [NotificationType.ATTENDANCE_OUTSIDE_WORK_WINDOW]: {
    label: "Fichajes fuera de horario",
  },
  [NotificationType.ATTENDANCE_OPEN_TOO_LONG]: {
    label: "Fichajes abiertos demasiado tiempo",
  },
  [NotificationType.ATTENDANCE_INCOMPLETE_DAY]: {
    label: "Jornada con fichaje incompleto",
  },
  [NotificationType.ATTENDANCE_MISSING_WORKDAY]: {
    label: "Día laborable sin fichaje",
  },
  [NotificationType.DELIVERY_FAILED]: {
    label: "Fallo de envío de notificación",
  },
} as const satisfies Record<NotificationType, { label: string }>;

const basePayloadSchema = z.object({
  eventKey: z.string().min(3),
});

const planningPayload = basePayloadSchema.extend({
  planningId: z.string().min(1),
  naveId: z.string().min(1),
});

const projectPayload = basePayloadSchema.extend({
  projectId: z.string().min(1),
});

const taskPayload = basePayloadSchema.extend({
  taskId: z.string().min(1),
  projectId: z.string().min(1),
  naveId: z.string().min(1),
});

const attendancePayload = basePayloadSchema.extend({
  userId: z.string().min(1),
  personId: z.string().min(1),
  dateIso: z.string().min(10),
});

export const notificationPayloadSchema = {
  [NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION]: planningPayload.extend({
    occupationPct: z.number().min(0),
    assignedHours: z.number().min(0),
    capacityHours: z.number().min(0),
  }),
  [NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE]: planningPayload.extend({
    projectIds: z.array(z.string().min(1)).min(1),
    projectCodes: z.array(z.string().min(1)).min(1),
  }),
  [NotificationType.TASK_HOURS_EXCEEDED]: taskPayload.extend({
    estimatedHours: z.number().min(0),
    doneHours: z.number().min(0),
  }),
  [NotificationType.PROJECT_SLIPPING]: projectPayload.extend({
    expectedEnd: z.string().datetime(),
    deliveryDate: z.string().datetime(),
  }),
  [NotificationType.ASSIGNED_TASKS_NOT_LOGGED]: planningPayload.extend({
    dateIso: z.string().min(10),
    personIds: z.array(z.string().min(1)).min(1),
  }),
  [NotificationType.ATTENDANCE_OUTSIDE_WORK_WINDOW]: attendancePayload.extend({
    atIso: z.string().datetime(),
  }),
  [NotificationType.ATTENDANCE_OPEN_TOO_LONG]: attendancePayload.extend({
    sessionId: z.string().min(1),
    durationMinutes: z.number().int().min(1),
  }),
  [NotificationType.ATTENDANCE_INCOMPLETE_DAY]: attendancePayload,
  [NotificationType.ATTENDANCE_MISSING_WORKDAY]: attendancePayload,
  [NotificationType.DELIVERY_FAILED]: basePayloadSchema.extend({
    deliveryId: z.string().min(1),
    originalType: z.nativeEnum(NotificationType),
    channel: z.string().min(1),
    attempts: z.number().int().min(1),
    error: z.string().min(1),
  }),
} as const satisfies Record<NotificationType, z.ZodType>;

export type NotificationPayloadByType = {
  [K in NotificationType]: z.infer<(typeof notificationPayloadSchema)[K]>;
};
