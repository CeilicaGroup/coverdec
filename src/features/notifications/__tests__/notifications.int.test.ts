import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ElementTypology,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
  ProjectKind,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { generatePlanning, publishPlanning } from "@/features/planning/service";
import { publishPlanningAction } from "@/features/planning/actions";
import { createLamp, createProject, setLampApprovedForPlanning, updateProject } from "@/features/projects/actions";
import { autoGroupIdenticalTasks } from "@/features/work-orders/actions";
import { setAbsence } from "@/features/people/actions";
import { upsertNotificationSubscription } from "@/features/notifications/service";
import { createHoliday } from "@/features/holidays/actions";
import { createManualEntry } from "@/features/time-tracking/actions";
import { createManualAttendanceSession } from "@/features/attendance/actions";
import { madridWallTimeToInstant } from "@/features/attendance/madrid-time";
import {
  markAllNotificationsRead,
  markAllNotificationsUnread,
  markNotificationRead,
  markNotificationUnread,
  updateNotificationSubscription,
} from "@/features/notifications/actions";
import {
  processOutboxBatch,
  scanAssignedTasksNotLogged,
  scanAttendanceIncidents,
  scanProjectSlipping,
} from "@/features/notifications/worker";
import { buildWorld, createPlannableLamp, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

const DAY_MS = 86_400_000;
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const WEEK_ISO = WEEK.toISOString().slice(0, 10);
const dayIso = (offset: number) => new Date(WEEK.getTime() + offset * DAY_MS).toISOString().slice(0, 10);

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const plan = () => generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });

async function publish() {
  await loginAs(world.users.admin.email);
  unwrap(await publishPlanningAction({ weekStart: WEEK_ISO }));
  return prisma.planning.findFirstOrThrow({ where: { naveId: world.naves.n1.id } });
}

const managers = () => [world.users.admin.id, world.users.jefe.id].sort();
const operarios = () => [world.users.ana.id, world.users.bea.id, world.users.carl.id];

function notificationsOf(type: NotificationType) {
  return prisma.notification.findMany({ where: { type }, orderBy: { userId: "asc" } });
}

/** Horas de horario de una persona en un día de la semana ISO, leídas de BD. */
async function dayHours(personId: string, isoWeekday: number) {
  const ws = await prisma.personWorkWindow.findMany({ where: { personId, dayOfWeek: isoWeekday } });
  return ws.reduce((s, w) => s + (w.endMinutes - w.startMinutes), 0) / 60;
}

/** Lámpara aprobada y agrupada en OT con proyecto propio (entrega y responsable opcionales). */
async function lampWithProject(opts: { name: string; deliveryDate?: string; responsibleUserId?: string; surfaceM2?: number }) {
  await loginAs(world.users.admin.email);
  const project = unwrap(
    await createProject({
      name: opts.name,
      kind: ProjectKind.PRODUCCION,
      isBillable: true,
      deliveryDate: opts.deliveryDate,
      responsibleUserId: opts.responsibleUserId,
    }),
  );
  const lamp = unwrap(
    await createLamp({
      projectId: project.id,
      name: "Lámpara",
      elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2: opts.surfaceM2 ?? 2, units: 1 }],
    }),
  );
  unwrap(await setLampApprovedForPlanning({ lampId: lamp.id, isApprovedForPlanning: true }));
  unwrap(await autoGroupIdenticalTasks());
  return prisma.project.findUniqueOrThrow({ where: { id: project.id } });
}

describe("al publicar el planning", () => {
  it("avisa de ocupación incompleta solo a admin y jefe, en la nave del planning y con cifras coherentes", async () => {
    await createPlannableLamp(world);
    await plan();
    const planning = await publish();

    const rows = await notificationsOf(NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION);
    expect(rows.map((n) => n.userId).sort()).toEqual(managers());
    expect(await prisma.notification.count({ where: { userId: { in: operarios() } } })).toBe(0);
    for (const n of rows) {
      expect(n.naveId).toBe(world.naves.n1.id);
      expect(n.planningId).toBe(planning.id);
      expect(n.readAt).toBeNull();
    }

    // Capacidad = horario semanal de las personas de N1 (Ana y Bea), no de Carl (N2).
    let capacity = 0;
    for (const p of [world.people.ana, world.people.bea]) for (let d = 1; d <= 5; d++) capacity += await dayHours(p.id, d);
    const assigned = (await prisma.planningAssignment.findMany({ where: { planningId: planning.id } })).reduce(
      (s, a) => s + a.hours,
      0,
    );
    const payload = rows[0]!.payload as { capacityHours: number; assignedHours: number; occupationPct: number };
    expect(payload.capacityHours).toBeCloseTo(capacity);
    expect(payload.assignedHours).toBeCloseTo(assigned);
    expect(payload.occupationPct).toBe(Math.round((assigned / capacity) * 100));

    // Canales por defecto: in-app + email (pendiente en la cola), sin push.
    const deliveries = await prisma.notificationDelivery.findMany({ orderBy: { userId: "asc" } });
    expect(deliveries.map((d) => [d.userId, d.channel, d.status])).toEqual(
      managers().map((id) => [id, NotificationChannel.EMAIL, NotificationDeliveryStatus.PENDING]),
    );
    for (const d of deliveries) expect(d.notificationId).toBe(rows.find((n) => n.userId === d.userId)!.id);
  }, 120_000);

  it("festivos y ausencias descuentan capacidad en el cálculo de ocupación", async () => {
    await createPlannableLamp(world);
    await loginAs(world.users.jefe.email);
    unwrap(await createHoliday({ startDate: dayIso(0), endDate: dayIso(0), name: "Fiesta" }));
    unwrap(await setAbsence({ personId: world.people.ana.id, date: dayIso(1), mode: "day", reason: "Médico" }));
    await plan();
    await publish();

    let capacity = 0;
    for (const p of [world.people.ana, world.people.bea]) for (let d = 2; d <= 5; d++) capacity += await dayHours(p.id, d);
    capacity -= await dayHours(world.people.ana.id, 2);
    const [n] = await notificationsOf(NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION);
    expect((n!.payload as { capacityHours: number }).capacityHours).toBeCloseTo(capacity);
  }, 120_000);

  it("avisa de los proyectos que acaban después de su fecha de entrega, y solo de esos", async () => {
    const late = await lampWithProject({ name: "Tarde", deliveryDate: dayIso(-3) });
    await lampWithProject({ name: "A tiempo", deliveryDate: dayIso(60) });
    await plan();
    await publish();

    const rows = await notificationsOf(NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE);
    expect(rows.map((n) => n.userId).sort()).toEqual(managers());
    expect(rows[0]!.payload).toMatchObject({ projectIds: [late.id], projectCodes: [late.code] });
  }, 120_000);

  it("cada responsable recibe solo sus proyectos fuera de plazo, según sus preferencias y sin duplicar a los gestores", async () => {
    const anaLate = await lampWithProject({ name: "De Ana", deliveryDate: dayIso(-3), responsibleUserId: world.users.ana.id });
    await lampWithProject({ name: "De Ana a tiempo", deliveryDate: dayIso(60), responsibleUserId: world.users.ana.id });
    await lampWithProject({ name: "De Carl", deliveryDate: dayIso(-3), responsibleUserId: world.users.carl.id });
    await lampWithProject({ name: "De Bea", deliveryDate: dayIso(-3), responsibleUserId: world.users.bea.id });
    await lampWithProject({ name: "Del jefe", deliveryDate: dayIso(-3), responsibleUserId: world.users.jefe.id });
    // Bea ha desactivado este aviso.
    await upsertNotificationSubscription({
      userId: world.users.bea.id,
      type: NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE,
      inApp: false,
      email: false,
      push: false,
    });
    await plan();
    await publish();

    const rows = await notificationsOf(NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE);
    const byUser = (id: string) => rows.filter((n) => n.userId === id);
    const late = await prisma.project.findMany({ where: { name: { in: ["De Ana", "De Carl", "De Bea", "Del jefe"] } } });

    // Gestores: un único aviso global con los 4 proyectos tardíos (el jefe no recibe otro como responsable).
    for (const id of managers()) {
      expect(byUser(id)).toHaveLength(1);
      expect(new Set((byUser(id)[0]!.payload as { projectIds: string[] }).projectIds)).toEqual(new Set(late.map((p) => p.id)));
    }
    // Ana: solo el suyo tardío; el que va a tiempo no aparece.
    expect(byUser(world.users.ana.id)).toHaveLength(1);
    expect(byUser(world.users.ana.id)[0]!.payload).toMatchObject({ projectIds: [anaLate.id], projectCodes: [anaLate.code] });
    // Carl es de otra nave, pero es responsable de un proyecto planificado en N1: también recibe el suyo.
    expect((byUser(world.users.carl.id)[0]!.payload as { projectCodes: string[] }).projectCodes).toEqual(["de-carl"]);
    // Bea lo tiene desactivado.
    expect(byUser(world.users.bea.id)).toHaveLength(0);
    expect(rows).toHaveLength(4);

    const emails = await prisma.notificationDelivery.findMany({
      where: { type: NotificationType.PLAN_PUBLISHED_PROJECTS_OVER_DEADLINE },
    });
    expect(emails.map((d) => d.userId).sort()).toEqual([...managers(), world.users.ana.id, world.users.carl.id].sort());
  }, 180_000);

  it("volver a publicar el mismo planning no duplica avisos ni envíos", async () => {
    await createPlannableLamp(world);
    await plan();
    const planning = await publish();
    const [notifications, deliveries] = [await prisma.notification.count(), await prisma.notificationDelivery.count()];
    expect(notifications).toBeGreaterThan(0);

    await publishPlanning(planning.id);
    expect(await prisma.notification.count()).toBe(notifications);
    expect(await prisma.notificationDelivery.count()).toBe(deliveries);
  }, 120_000);
});

describe("preferencias de notificación", () => {
  it("respeta los canales configurados por usuario", async () => {
    await loginAs(world.users.admin.email);
    unwrap(
      await updateNotificationSubscription({
        userId: world.users.jefe.id,
        type: NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION,
        inApp: false,
        email: false,
        push: false,
      }),
    );
    unwrap(
      await updateNotificationSubscription({
        userId: world.users.admin.id,
        type: NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION,
        inApp: true,
        email: false,
        push: false,
      }),
    );

    await createPlannableLamp(world);
    await plan();
    await publish();

    const rows = await notificationsOf(NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION);
    expect(rows.map((n) => n.userId)).toEqual([world.users.admin.id]);
    expect(await prisma.notificationDelivery.count()).toBe(0);
  }, 120_000);

  it("solo el admin las configura y solo para admins o jefes", async () => {
    const input = {
      type: NotificationType.PROJECT_SLIPPING,
      inApp: false,
      email: false,
      push: false,
    };
    await loginAs(world.users.jefe.email);
    await expect(updateNotificationSubscription({ ...input, userId: world.users.jefe.id })).rejects.toThrow(/NEXT_REDIRECT/);

    await loginAs(world.users.admin.email);
    expect(expectFail(await updateNotificationSubscription({ ...input, userId: world.users.ana.id }))).toMatch(
      /administradores o jefes/,
    );
    expect(await prisma.notificationSubscription.count()).toBe(0);
  });
});

describe("leídas / no leídas", () => {
  async function publishedWorld() {
    await lampWithProject({ name: "Tarde", deliveryDate: dayIso(-3) });
    await plan();
    await publish();
    const adminRows = await prisma.notification.findMany({ where: { userId: world.users.admin.id } });
    const jefeRows = await prisma.notification.findMany({ where: { userId: world.users.jefe.id } });
    expect(adminRows).toHaveLength(2); // ocupación + fuera de plazo
    expect(jefeRows).toHaveLength(2);
    return { adminRows, jefeRows };
  }

  const readState = async (userId: string) =>
    (await prisma.notification.findMany({ where: { userId }, orderBy: { id: "asc" } })).map((n) => n.readAt !== null);

  it("cada usuario solo marca las suyas", async () => {
    const { adminRows } = await publishedWorld();

    await loginAs(world.users.jefe.email);
    unwrap(await markNotificationRead({ notificationId: adminRows[0]!.id }));
    expect(await readState(world.users.admin.id)).toEqual([false, false]);

    unwrap(await markAllNotificationsRead());
    expect(await readState(world.users.jefe.id)).toEqual([true, true]);
    expect(await readState(world.users.admin.id)).toEqual([false, false]);

    await loginAs(world.users.admin.email);
    unwrap(await markNotificationRead({ notificationId: adminRows[0]!.id }));
    const first = await prisma.notification.findUniqueOrThrow({ where: { id: adminRows[0]!.id } });
    expect(first.readAt).not.toBeNull();

    // Marcar otra vez como leída no cambia la fecha de lectura.
    unwrap(await markNotificationRead({ notificationId: adminRows[0]!.id }));
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: adminRows[0]!.id } })).readAt).toEqual(first.readAt);

    unwrap(await markNotificationUnread({ notificationId: adminRows[0]!.id }));
    expect(await readState(world.users.admin.id)).toEqual([false, false]);

    await loginAs(world.users.admin.email);
    unwrap(await markAllNotificationsUnread({ filter: "all" }));
    expect(await readState(world.users.jefe.id)).toEqual([true, true]);
  }, 120_000);
});

/**
 * Prisma rellena `nextAttemptAt` con el reloj de Node y el worker lo compara con NOW() de Postgres;
 * el contenedor de test va unos ms por detrás, así que esperamos a que la BD vea el envío como vencido.
 */
async function waitUntilDueInDb() {
  for (let i = 0; i < 100; i++) {
    const [row] = await prisma.$queryRaw<Array<{ due: boolean }>>`
      SELECT COALESCE(MAX("nextAttemptAt") <= NOW(), true) AS due FROM "NotificationDelivery"`;
    if (row?.due) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("los envíos nunca llegaron a estar vencidos según la BD");
}

describe("worker: cola de envíos", () => {
  async function queuedEmails() {
    await createPlannableLamp(world);
    await plan();
    await publish();
    const pending = await prisma.notificationDelivery.findMany();
    expect(pending).toHaveLength(2);
    await waitUntilDueInDb();
    return pending;
  }

  it("sin proveedor de email configurado, reintenta con espera y no vuelve a coger el envío antes de tiempo", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await queuedEmails();

    const t0 = Date.now();
    expect(await processOutboxBatch()).toBe(2);
    for (const d of await prisma.notificationDelivery.findMany()) {
      expect(d.status).toBe(NotificationDeliveryStatus.PENDING);
      expect(d.attempts).toBe(1);
      expect(d.lockedAt).toBeNull();
      expect(d.sentAt).toBeNull();
      expect(d.lastError).toMatch(/RESEND_API_KEY/);
      // Backoff 2^1 = 2 minutos.
      expect(d.nextAttemptAt.getTime() - t0).toBeGreaterThanOrEqual(2 * 60_000 - 5_000);
    }
    expect(await processOutboxBatch()).toBe(0);
  }, 120_000);

  it("al agotar los intentos el envío queda FAILED y se avisa in-app (sin generar más emails)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    await queuedEmails();
    const notificationsBefore = await prisma.notification.count();

    for (let i = 0; i < 5; i++) {
      // Simula que ha pasado el tiempo de espera.
      await prisma.notificationDelivery.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await processOutboxBatch();
    }

    const deliveries = await prisma.notificationDelivery.findMany({ where: { channel: NotificationChannel.EMAIL } });
    expect(deliveries).toHaveLength(2);
    for (const d of deliveries) {
      expect(d.status).toBe(NotificationDeliveryStatus.FAILED);
      expect(d.attempts).toBe(5);
    }

    const failed = await notificationsOf(NotificationType.DELIVERY_FAILED);
    // Un aviso por envío fallido para cada gestor: 2 envíos × 2 gestores.
    expect(failed).toHaveLength(4);
    expect(new Set(failed.map((n) => n.userId))).toEqual(new Set(managers()));
    expect(await prisma.notification.count()).toBe(notificationsBefore + 4);
    expect(await prisma.notificationDelivery.count()).toBe(2);

    await prisma.notificationDelivery.updateMany({ data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await processOutboxBatch()).toBe(0);
  }, 120_000);

  it("con el proveedor OK envía cada email una sola vez al destinatario correcto, aunque corran dos workers a la vez", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("NOTIFICATION_FROM_EMAIL", "avisos@test.local");
    await queuedEmails(); // antes de falsear fetch: el planificador habla con el solver por HTTP
    const sent: Array<{ to: string[]; subject: string; auth: string | null }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe("https://api.resend.com/emails");
        await new Promise((r) => setTimeout(r, 50));
        const body = JSON.parse(String(init.body)) as { to: string[]; subject: string };
        sent.push({ ...body, auth: new Headers(init.headers).get("authorization") });
        return new Response("{}", { status: 200 });
      }),
    );

    const [a, b] = await Promise.all([processOutboxBatch(), processOutboxBatch()]);
    expect(a + b).toBe(2);
    expect(sent.map((s) => s.to[0]).sort()).toEqual(["admin@test.local", "jefe@test.local"]);
    expect(sent.every((s) => s.subject === "Plan publicado con ocupación incompleta")).toBe(true);
    expect(sent.every((s) => s.auth === "Bearer test-key")).toBe(true);

    for (const d of await prisma.notificationDelivery.findMany()) {
      expect(d.status).toBe(NotificationDeliveryStatus.SENT);
      expect(d.sentAt).not.toBeNull();
      expect(d.lockedAt).toBeNull();
    }
    expect(await processOutboxBatch()).toBe(0);
    expect(sent).toHaveLength(2);
  }, 120_000);

  it("si el proveedor responde error, se guarda el motivo y se reintenta", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    vi.stubEnv("NOTIFICATION_FROM_EMAIL", "avisos@test.local");
    await queuedEmails();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));

    await processOutboxBatch();
    for (const d of await prisma.notificationDelivery.findMany()) {
      expect(d.status).toBe(NotificationDeliveryStatus.PENDING);
      expect(d.attempts).toBe(1);
      expect(d.lastError).toBe("Resend failed (429): rate limited");
    }
  }, 120_000);
});

describe("worker: proyecto que se alarga", () => {
  it("avisa a gestores y al responsable del proyecto solo con planning publicado, sin repetir, y se resuelve al corregir la fecha", async () => {
    const project = await lampWithProject({
      name: "Tarde",
      deliveryDate: dayIso(-3),
      responsibleUserId: world.users.ana.id,
    });
    await plan();

    // Un borrador no cuenta.
    await scanProjectSlipping();
    expect(await notificationsOf(NotificationType.PROJECT_SLIPPING)).toHaveLength(0);

    await publish();
    await scanProjectSlipping();
    await scanProjectSlipping();
    const rows = await notificationsOf(NotificationType.PROJECT_SLIPPING);
    expect(rows.map((n) => n.userId).sort()).toEqual([...managers(), world.users.ana.id].sort());
    expect(rows.every((n) => n.projectId === project.id)).toBe(true);

    // Con la entrega movida a después del plan, el aviso deja de estar activo.
    await loginAs(world.users.admin.email);
    unwrap(
      await updateProject({
        projectId: project.id,
        name: project.name,
        kind: project.kind,
        isBillable: project.isBillable,
        deliveryDate: dayIso(60),
        responsibleUserId: world.users.ana.id,
      }),
    );
    await scanProjectSlipping();
    const states = await prisma.notificationState.findMany({ where: { type: NotificationType.PROJECT_SLIPPING } });
    expect(states).toHaveLength(3);
    expect(states.every((s) => !s.isActive && s.resolvedAt !== null)).toBe(true);
    expect(await notificationsOf(NotificationType.PROJECT_SLIPPING)).toHaveLength(3);

    // Se vuelve a retrasar: es una ocurrencia nueva y se avisa otra vez (aviso y email nuevos)…
    await loginAs(world.users.admin.email);
    unwrap(
      await updateProject({
        projectId: project.id,
        name: project.name,
        kind: project.kind,
        isBillable: project.isBillable,
        deliveryDate: dayIso(-3),
        responsibleUserId: world.users.ana.id,
      }),
    );
    await scanProjectSlipping();
    // …pero mientras siga activo, no se repite.
    await scanProjectSlipping();

    const again = await notificationsOf(NotificationType.PROJECT_SLIPPING);
    expect(again).toHaveLength(6);
    for (const userId of [...managers(), world.users.ana.id]) {
      const mine = again.filter((n) => n.userId === userId);
      expect(mine).toHaveLength(2);
      const keys = mine.map((n) => (n.payload as { eventKey: string }).eventKey);
      expect(new Set(keys).size).toBe(2);
    }
    const emails = await prisma.notificationDelivery.findMany({ where: { type: NotificationType.PROJECT_SLIPPING } });
    expect(emails).toHaveLength(6);
    expect(new Set(emails.map((d) => d.dedupeKey)).size).toBe(6);
    // Los estados vuelven a estar activos (el siguiente cambio a «a tiempo» los resolverá de nuevo).
    expect(
      (await prisma.notificationState.findMany({ where: { type: NotificationType.PROJECT_SLIPPING } })).every((s) => s.isActive),
    ).toBe(true);
  }, 120_000);
});

describe("worker: planning publicado sin partes de horas", () => {
  it("el día planificado avisa de las personas con tareas sin fichar, una vez, y excluye las tareas ya fichadas", async () => {
    await createPlannableLamp(world, { surfaceM2: 6 });
    await plan();
    const planning = await publish();
    const rows = await prisma.planningAssignment.findMany({ where: { planningId: planning.id } });
    const firstDay = rows.map((r) => r.date.getTime()).sort((x, y) => x - y)[0]!;
    const dayRows = rows.filter((r) => r.date.getTime() === firstDay);
    const theDay = new Date(firstDay).toISOString().slice(0, 10);

    // Ese día a las 18:00 (hora del cron).
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(`${theDay}T18:00:00.000Z`) });

    // El primer día solo puede haber CNC (cadena): Ana lo ficha.
    const cnc = dayRows.find((r) => r.process === "CNC")!;
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: (await prisma.task.findUniqueOrThrow({ where: { id: cnc.taskId } })).projectId,
        lampId: (await prisma.task.findUniqueOrThrow({ where: { id: cnc.taskId } })).lampId,
        taskId: cnc.taskId,
        process: "CNC",
        startedAt: `${theDay}T08:00:00.000Z`,
        hours: 1,
      }),
    );
    const expectedPeople = [
      ...new Set(dayRows.filter((r) => r.taskId !== cnc.taskId).map((r) => r.personId)),
    ].sort();

    await scanAssignedTasksNotLogged();
    await scanAssignedTasksNotLogged();
    const notes = await notificationsOf(NotificationType.ASSIGNED_TASKS_NOT_LOGGED);
    if (expectedPeople.length === 0) {
      expect(notes).toHaveLength(0);
    } else {
      expect(notes.map((n) => n.userId).sort()).toEqual(managers());
      expect(notes.every((n) => n.naveId === world.naves.n1.id && n.planningId === planning.id)).toBe(true);
      expect(((notes[0]!.payload as { personIds: string[] }).personIds ?? []).sort()).toEqual(expectedPeople);
    }

    // Un día sin planning publicado no genera nada.
    await prisma.notification.deleteMany();
    await prisma.notificationState.deleteMany();
    vi.setSystemTime(new Date(`${dayIso(-3)}T18:00:00.000Z`));
    await scanAssignedTasksNotLogged();
    expect(await prisma.notification.count()).toBe(0);
  }, 120_000);

  it("sin fichar nada, avisa de todas las personas con tareas ese día", async () => {
    await createPlannableLamp(world);
    await plan();
    const planning = await publish();
    const rows = await prisma.planningAssignment.findMany({ where: { planningId: planning.id } });
    const firstDay = rows.map((r) => r.date.getTime()).sort((x, y) => x - y)[0]!;
    const expectedPeople = [...new Set(rows.filter((r) => r.date.getTime() === firstDay).map((r) => r.personId))].sort();

    vi.useFakeTimers({ toFake: ["Date"], now: new Date(firstDay + 18 * 3_600_000) });
    await scanAssignedTasksNotLogged();
    const notes = await notificationsOf(NotificationType.ASSIGNED_TASKS_NOT_LOGGED);
    expect(notes.map((n) => n.userId).sort()).toEqual(managers());
    expect((notes[0]!.payload as { personIds: string[] }).personIds.sort()).toEqual(expectedPeople);
  }, 120_000);
});

describe("worker: incidencias de fichaje de presencia", () => {
  const missing = () => notificationsOf(NotificationType.ATTENDANCE_MISSING_WORKDAY);
  const scopeOf = (n: { payload: unknown }) => (n.payload as { personId: string }).personId;
  // Convención del fichaje: instantes reales en BD; día y horario en hora de Madrid.
  const madrid = (offset: number, hhmm: string) => madridWallTimeToInstant(dayIso(offset), hhmm);

  it("en un día laborable ya empezado, avisa (una vez) de cada operario sin fichaje", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: madrid(2, "12:00") }); // miércoles
    await scanAttendanceIncidents();
    await scanAttendanceIncidents();
    const rows = await missing();
    // 3 operarios con usuario × 2 gestores.
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map(scopeOf))).toEqual(
      new Set([world.people.ana.id, world.people.bea.id, world.people.carl.id]),
    );
    expect(new Set(rows.map((n) => n.userId))).toEqual(new Set(managers()));
    expect(new Set(rows.map((n) => (n.payload as { dateIso: string }).dateIso))).toEqual(new Set([dayIso(2)]));
  });

  it("la jornada empieza a las 08:00 de Madrid, no a las 08:00 UTC", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: madrid(2, "07:55") });
    await scanAttendanceIncidents();
    expect(await missing()).toHaveLength(0);

    // 08:30 en Madrid es antes de las 08:00 UTC: con el corte en UTC no avisaría.
    vi.setSystemTime(madrid(2, "08:30"));
    expect(new Date().getUTCHours()).toBeLessThan(8);
    await scanAttendanceIncidents();
    expect(new Set((await missing()).map(scopeOf)).size).toBe(3);
  });

  it("un fichaje de madrugada (hora de Madrid) cuenta para ese día, no para el anterior", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: madrid(2, "12:00") }); // miércoles
    // Ana fichó el miércoles de 00:30 a 01:30 de Madrid: en UTC aún es martes.
    await loginAs(world.users.ana.email);
    unwrap(await createManualAttendanceSession({ date: dayIso(2), startTime: "00:30", endTime: "01:30" }));
    // Bea fichó el martes a última hora: no cuenta para el miércoles.
    await loginAs(world.users.bea.email);
    unwrap(await createManualAttendanceSession({ date: dayIso(1), startTime: "23:00", endTime: "23:30" }));
    const ana = await prisma.attendanceSession.findFirstOrThrow({ where: { userId: world.users.ana.id } });
    expect(ana.startedAt.toISOString().slice(0, 10)).toBe(dayIso(1));

    await scanAttendanceIncidents();
    expect(new Set((await missing()).map(scopeOf))).toEqual(new Set([world.people.bea.id, world.people.carl.id]));
  });

  it("no avisa en fin de semana, en festivo, a quien está de ausencia todo el día ni antes de empezar la jornada", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: madrid(5, "12:00") }); // sábado
    await scanAttendanceIncidents();
    expect(await missing()).toHaveLength(0);

    vi.setSystemTime(madrid(2, "00:05")); // miércoles de madrugada
    await scanAttendanceIncidents();
    expect(await missing()).toHaveLength(0);

    vi.useRealTimers();
    await loginAs(world.users.jefe.email);
    unwrap(await createHoliday({ startDate: dayIso(3), endDate: dayIso(3), name: "Fiesta" }));
    unwrap(await setAbsence({ personId: world.people.ana.id, date: dayIso(2), mode: "day", reason: "Vacaciones" }));

    vi.useFakeTimers({ toFake: ["Date"], now: madrid(3, "12:00") }); // jueves festivo
    await scanAttendanceIncidents();
    expect(await missing()).toHaveLength(0);

    vi.setSystemTime(madrid(2, "12:00")); // miércoles: Ana de vacaciones
    await scanAttendanceIncidents();
    expect(new Set((await missing()).map(scopeOf))).toEqual(new Set([world.people.bea.id, world.people.carl.id]));
  });
});
