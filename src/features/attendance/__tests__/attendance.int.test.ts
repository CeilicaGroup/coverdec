import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { madridHhmm, madridWallTimeToInstant } from "@/features/attendance/madrid-time";
import { AttendanceSource, NotificationType } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  adminCreateAttendanceBreak,
  adminDeleteAttendanceBreak,
  adminDeleteAttendanceSession,
  adminUpdateAttendanceBreak,
  adminUpsertAttendanceSession,
  createManualAttendanceSession,
  createOwnAttendanceBreak,
  deleteOwnAttendanceBreak,
  deleteOwnAttendanceSession,
  endBreak,
  getAttendanceRange,
  startAttendance,
  startBreak,
  stopAttendance,
  updateOwnAttendanceBreak,
  updateOwnAttendanceSession,
} from "@/features/attendance/actions";
import { savePersonWorkWindows } from "@/features/people/actions";
import { createManualEntriesFromRanges } from "@/features/time-tracking/actions";
import {
  buildWorld,
  createPlannableLamp,
  expectFail,
  loginAs,
  unwrap,
  type World,
} from "@/test/integration/world";

let world: World;

// Un martes ya pasado (horario de verano, UTC+2). Horario por defecto: 08–14 y 15–17 → comida 14–15.
const DAY = "2026-10-20";
const NEXT_DAY = "2026-10-21";
/** Convención de fichaje: el usuario teclea hora de Madrid; en BD va el instante real. */
const wall = (hhmm: string, day = DAY) => madridWallTimeToInstant(day, hhmm);

beforeEach(async () => {
  world = await buildWorld();
});

async function sessionsOf(userId: string) {
  return prisma.attendanceSession.findMany({
    where: { userId },
    include: { breaks: { orderBy: { startedAt: "asc" } } },
    orderBy: { startedAt: "asc" },
  });
}

async function onlySessionOf(userId: string) {
  const rows = await sessionsOf(userId);
  expect(rows, "se esperaba exactamente una sesión").toHaveLength(1);
  return rows[0]!;
}

const minutesBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60_000);

/**
 * Invariantes de presencia sobre TODA la BD:
 * - una sesión cerrada guarda minutos = bruto − pausas (y nunca negativos);
 * - cada pausa cerrada guarda sus minutos y cae dentro de su sesión;
 * - las pausas de una sesión no se solapan; las sesiones cerradas de un usuario tampoco;
 * - como mucho una sesión abierta por usuario y una pausa abierta por sesión.
 */
async function assertAttendanceConsistent() {
  const sessions = await prisma.attendanceSession.findMany({
    include: { breaks: { orderBy: { startedAt: "asc" } } },
    orderBy: [{ userId: "asc" }, { startedAt: "asc" }],
  });
  const openByUser = new Map<string, number>();
  for (const s of sessions) {
    const label = `sesión ${s.source} ${s.startedAt.toISOString()}`;
    if (!s.endedAt) {
      openByUser.set(s.userId, (openByUser.get(s.userId) ?? 0) + 1);
    }
    expect(s.breaks.filter((b) => !b.endedAt).length, `${label}: pausas abiertas`).toBeLessThanOrEqual(
      s.endedAt ? 0 : 1,
    );
    let prevEnd: Date | null = null;
    let breakTotal = 0;
    for (const b of s.breaks) {
      expect(b.startedAt >= s.startedAt, `${label}: pausa antes del inicio`).toBe(true);
      if (!b.endedAt) continue;
      if (s.endedAt) expect(b.endedAt <= s.endedAt, `${label}: pausa tras el fin`).toBe(true);
      expect(b.minutes, `${label}: minutos de la pausa`).toBe(minutesBetween(b.startedAt, b.endedAt));
      if (prevEnd) expect(b.startedAt >= prevEnd, `${label}: pausas solapadas`).toBe(true);
      prevEnd = b.endedAt;
      breakTotal += b.endedAt.getTime() - b.startedAt.getTime();
    }
    if (s.endedAt) {
      const expected = Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime() - breakTotal) / 60_000));
      expect(s.minutes, `${label}: minutos = bruto − pausas`).toBe(expected);
    }
  }
  for (const [userId, count] of openByUser) {
    expect(count, `usuario ${userId}: sesiones abiertas`).toBeLessThanOrEqual(1);
  }
  const closed = sessions.filter((s) => s.endedAt);
  for (let i = 1; i < closed.length; i++) {
    const prev = closed[i - 1]!;
    const cur = closed[i]!;
    if (prev.userId !== cur.userId) continue;
    expect(cur.startedAt >= prev.endedAt!, `usuario ${cur.userId}: sesiones solapadas`).toBe(true);
  }
}

async function notificationsOf(type: NotificationType) {
  return prisma.notification.findMany({ where: { type }, orderBy: { userId: "asc" } });
}

const managerIds = () => [world.users.admin.id, world.users.jefe.id].sort();

describe("fichaje en vivo (botón entrar / pausa / salir)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${DAY}T06:00:00.000Z`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const clock = (utcHhmm: string) => vi.setSystemTime(new Date(`${DAY}T${utcHhmm}:00.000Z`));

  it("entrar → pausa → volver → salir descuenta exactamente la pausa de los minutos trabajados", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await startAttendance({ notes: "entrada" }));

    const open = await onlySessionOf(world.users.ana.id);
    expect(open.source).toBe(AttendanceSource.BUTTON);
    expect(open.personId).toBe(world.people.ana.id);
    expect(open.endedAt).toBeNull();
    expect(open.minutes).toBeNull();

    clock("08:00");
    unwrap(await startBreak());
    clock("08:30");
    unwrap(await endBreak());
    clock("11:00");
    unwrap(await stopAttendance());

    const closed = await onlySessionOf(world.users.ana.id);
    expect(closed.endedAt!.toISOString()).toBe(`${DAY}T11:00:00.000Z`);
    expect(closed.breaks).toHaveLength(1);
    expect(closed.breaks[0]!.minutes).toBe(30);
    expect(closed.breaks[0]!.source).toBe(AttendanceSource.BUTTON);
    expect(closed.minutes).toBe(5 * 60 - 30);
    expect(closed.notes).toBe("entrada"); // salir sin notas no borra las de entrada
    await assertAttendanceConsistent();
  });

  it("salir con una pausa abierta la cierra a la hora de salida y no la cuenta como trabajo", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await startAttendance());
    clock("09:00");
    unwrap(await startBreak());
    clock("10:00");
    unwrap(await stopAttendance());

    const s = await onlySessionOf(world.users.ana.id);
    expect(s.breaks).toHaveLength(1);
    expect(s.breaks[0]!.endedAt!.toISOString()).toBe(`${DAY}T10:00:00.000Z`);
    expect(s.breaks[0]!.minutes).toBe(60);
    expect(s.minutes).toBe(3 * 60);
    await assertAttendanceConsistent();
  });

  it("solo una sesión abierta por persona y una pausa abierta por sesión; sin sesión no hay pausa", async () => {
    await loginAs(world.users.ana.email);
    expect(expectFail(await stopAttendance())).toMatch(/No hay fichaje diario activo/);
    expect(expectFail(await startBreak())).toMatch(/No hay fichaje diario activo/);
    expect(expectFail(await endBreak())).toMatch(/No hay pausa activa/);
    expect(await prisma.attendanceSession.count()).toBe(0);

    unwrap(await startAttendance());
    expect(expectFail(await startAttendance())).toMatch(/Ya tienes un fichaje diario activo/);
    clock("07:00");
    unwrap(await startBreak());
    expect(expectFail(await startBreak())).toMatch(/Ya hay una pausa abierta/);

    const s = await onlySessionOf(world.users.ana.id);
    expect(s.breaks).toHaveLength(1);
    await assertAttendanceConsistent();
  });

  it("una doble pulsación simultánea en «Entrar» o «Pausa» crea una sola sesión y una sola pausa", async () => {
    await loginAs(world.users.ana.email);
    const starts = await Promise.all([startAttendance(), startAttendance(), startAttendance()]);
    expect(starts.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.attendanceSession.count()).toBe(1);

    clock("07:00");
    const pauses = await Promise.all([startBreak(), startBreak(), startBreak()]);
    expect(pauses.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.attendanceBreak.count()).toBe(1);

    clock("07:30");
    unwrap(await endBreak());
    clock("10:00");
    unwrap(await stopAttendance());
    // 4h brutas − 30 min de pausa (una sola vez).
    expect((await onlySessionOf(world.users.ana.id)).minutes).toBe(210);
    await assertAttendanceConsistent();
  });

  it("tras salir se puede volver a entrar el mismo día: dos sesiones sin solape", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await startAttendance());
    clock("12:00");
    unwrap(await stopAttendance());
    clock("13:00");
    unwrap(await startAttendance());
    clock("15:00");
    unwrap(await stopAttendance());

    const rows = await sessionsOf(world.users.ana.id);
    expect(rows.map((r) => r.minutes)).toEqual([360, 120]);
    await assertAttendanceConsistent();
  });

  it("un operario no puede cerrar ni pausar la sesión de otro aunque conozca su id", async () => {
    await loginAs(world.users.bea.email);
    unwrap(await startAttendance());
    const beaSession = await onlySessionOf(world.users.bea.id);

    await loginAs(world.users.ana.email);
    clock("08:00");
    expect(expectFail(await stopAttendance({ sessionId: beaSession.id }))).toMatch(/No hay fichaje diario activo/);
    expect(expectFail(await startBreak({ sessionId: beaSession.id }))).toMatch(/No hay fichaje diario activo/);

    const after = await onlySessionOf(world.users.bea.id);
    expect(after.endedAt).toBeNull();
    expect(after.breaks).toHaveLength(0);
  });

  it("un usuario sin persona vinculada (admin) no puede fichar", async () => {
    await loginAs(world.users.admin.email);
    expect(expectFail(await startAttendance())).toMatch(/no tiene persona vinculada/);
    expect(await prisma.attendanceSession.count()).toBe(0);
  });

  it("cerrar una sesión de ≥12h avisa a jefe y admin una sola vez; una de menos de 12h no avisa", async () => {
    await loginAs(world.users.bea.email);
    unwrap(await startAttendance());
    clock("17:59"); // 11h59
    unwrap(await stopAttendance());
    expect(await notificationsOf(NotificationType.ATTENDANCE_OPEN_TOO_LONG)).toHaveLength(0);

    vi.setSystemTime(new Date(`${NEXT_DAY}T06:00:00.000Z`));
    await loginAs(world.users.ana.email);
    unwrap(await startAttendance());
    vi.setSystemTime(new Date(`${NEXT_DAY}T18:30:00.000Z`)); // 12h30 sin pausas
    unwrap(await stopAttendance());

    const anaSession = (await sessionsOf(world.users.ana.id))[0]!;
    expect(anaSession.minutes).toBe(750);
    const alerts = await notificationsOf(NotificationType.ATTENDANCE_OPEN_TOO_LONG);
    expect(alerts.map((n) => n.userId).sort()).toEqual(managerIds());
    for (const n of alerts) {
      expect(n.payload).toMatchObject({ sessionId: anaSession.id, durationMinutes: 750, userId: world.users.ana.id });
    }

    // El jefe borra esa sesión anómala: el aviso «abierto demasiado» queda resuelto
    // y se abre «día incompleto» para que alguien registre la jornada correcta.
    await loginAs(world.users.jefe.email);
    unwrap(await adminDeleteAttendanceSession({ sessionId: anaSession.id }));
    expect(await sessionsOf(world.users.ana.id)).toHaveLength(0);
    const tooLongStates = await prisma.notificationState.findMany({
      where: { type: NotificationType.ATTENDANCE_OPEN_TOO_LONG },
    });
    expect(tooLongStates).toHaveLength(2);
    expect(tooLongStates.every((s) => !s.isActive && s.resolvedAt)).toBe(true);
    const incomplete = await notificationsOf(NotificationType.ATTENDANCE_INCOMPLETE_DAY);
    expect(incomplete.map((n) => n.userId).sort()).toEqual(managerIds());
    expect(incomplete[0]!.payload).toMatchObject({ userId: world.users.ana.id, dateIso: NEXT_DAY });
  });
});

describe("franja manual del operario y la pausa de comida", () => {
  beforeEach(async () => {
    await loginAs(world.users.ana.email);
  });

  const manual = (startTime: string, endTime: string, extra: Partial<Parameters<typeof createManualAttendanceSession>[0]> = {}) =>
    createManualAttendanceSession({ date: DAY, startTime, endTime, ...extra });

  it("una franja que no toca la comida se guarda tal cual, sin preguntar", async () => {
    unwrap(await manual("08:00", "14:00"));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.source).toBe(AttendanceSource.MANUAL);
    // 08:00–14:00 en Madrid (CEST) se guardan como los instantes reales 06:00Z–12:00Z, igual que «Mis horas».
    expect(s.startedAt.toISOString()).toBe(`${DAY}T06:00:00.000Z`);
    expect(s.endedAt!.toISOString()).toBe(`${DAY}T12:00:00.000Z`);
    expect(s.minutes).toBe(360);
    expect(s.breaks).toHaveLength(0);
  });

  it("8–17 cruza la comida: sin respuesta se rechaza y no se guarda nada", async () => {
    expect(expectFail(await manual("08:00", "17:00"))).toMatch(/cruza una franja de descanso/);
    expect(await prisma.attendanceSession.count()).toBe(0);
    expect(await prisma.attendanceBreak.count()).toBe(0);
  });

  it("en fin de semana sin horario propio no pregunta por la comida (no hereda el viernes)", async () => {
    const saturday = "2026-10-24";
    unwrap(await createManualAttendanceSession({ date: saturday, startTime: "08:00", endTime: "17:00" }));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.startedAt).toEqual(wall("08:00", saturday));
    expect(s.minutes).toBe(9 * 60);
    expect(s.breaks).toHaveLength(0);
  });

  it("8–17 «hice descanso» guarda la pausa 14–15 y cuenta 8h", async () => {
    unwrap(await manual("08:00", "17:00", { breakHandling: "took_break" }));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.minutes).toBe(8 * 60);
    expect(s.breaks.map((b) => [b.startedAt, b.endedAt, b.minutes, b.source])).toEqual([
      [wall("14:00"), wall("15:00"), 60, AttendanceSource.MANUAL],
    ]);
    await assertAttendanceConsistent();
  });

  it("8–17 «trabajé extra» no crea pausa y cuenta las 9h", async () => {
    unwrap(await manual("08:00", "17:00", { breakHandling: "worked_extra" }));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.minutes).toBe(9 * 60);
    expect(s.breaks).toHaveLength(0);
  });

  it("si la franja solo pisa parte de la comida, la pausa es solo esa parte", async () => {
    unwrap(await manual("13:30", "14:20", { breakHandling: "took_break" }));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.breaks.map((b) => [b.startedAt, b.endedAt])).toEqual([[wall("14:00"), wall("14:20")]]);
    expect(s.minutes).toBe(30);
    await assertAttendanceConsistent();
  });

  it("una franja que es solo comida no puede ser «descanso» (0 min), pero sí «trabajé extra»", async () => {
    expect(expectFail(await manual("14:00", "15:00", { breakHandling: "took_break" }))).toMatch(/solo a descanso/);
    expect(await prisma.attendanceSession.count()).toBe(0);

    unwrap(await manual("14:00", "15:00", { breakHandling: "worked_extra" }));
    expect((await onlySessionOf(world.users.ana.id)).minutes).toBe(60);
  });

  it("con jornada continua (sin hueco de comida) 8–17 no pregunta y cuenta 9h", async () => {
    await loginAs(world.users.jefe.email);
    await savePersonWorkWindows({
      personId: world.people.ana.id,
      windows: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinutes: 7 * 60, endMinutes: 15 * 60 })),
    });

    await loginAs(world.users.ana.email);
    unwrap(await manual("08:00", "17:00"));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.minutes).toBe(9 * 60);
    expect(s.breaks).toHaveLength(0);
  });

  it("el horario de cada persona decide la comida: un hueco 13–14 pregunta por 13–14, no por 14–15", async () => {
    await loginAs(world.users.jefe.email);
    await savePersonWorkWindows({
      personId: world.people.bea.id,
      windows: [1, 2, 3, 4, 5].flatMap((dayOfWeek) => [
        { dayOfWeek, startMinutes: 7 * 60, endMinutes: 13 * 60 },
        { dayOfWeek, startMinutes: 14 * 60, endMinutes: 16 * 60 },
      ]),
    });

    await loginAs(world.users.bea.email);
    // 14:00–15:30 no cruza su comida (13–14) aunque sí la del horario por defecto.
    unwrap(await manual("14:00", "15:30"));
    expect(expectFail(await manual("12:00", "13:30"))).toMatch(/cruza una franja de descanso/);
    unwrap(await manual("07:00", "14:00", { breakHandling: "took_break" }));

    const rows = await sessionsOf(world.users.bea.id);
    expect(rows.map((r) => r.minutes)).toEqual([360, 90]);
    expect(rows[0]!.breaks.map((b) => [b.startedAt, b.endedAt])).toEqual([[wall("13:00"), wall("14:00")]]);
    await assertAttendanceConsistent();
  });

  it("no deja solapar franjas propias (pegadas sí), pero otra persona puede tener las mismas horas", async () => {
    unwrap(await manual("08:00", "12:00"));
    expect(expectFail(await manual("11:00", "13:00"))).toMatch(/se solapa/);
    expect(expectFail(await manual("07:00", "17:00", { breakHandling: "worked_extra" }))).toMatch(/se solapa/);
    unwrap(await manual("12:00", "14:00"));

    await loginAs(world.users.bea.email);
    unwrap(await manual("08:00", "12:00"));

    expect((await sessionsOf(world.users.ana.id)).map((s) => s.minutes)).toEqual([240, 120]);
    expect(await sessionsOf(world.users.bea.id)).toHaveLength(1);
    await assertAttendanceConsistent();
  });

  it("con un fichaje en vivo abierto no se puede registrar una franja manual", async () => {
    unwrap(await startAttendance());
    expect(expectFail(await manual("08:00", "12:00"))).toMatch(/Cierra el fichaje activo/);
    const rows = await sessionsOf(world.users.ana.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.source).toBe(AttendanceSource.BUTTON);
  });

  it("valida horas: fin anterior o igual al inicio se rechaza", async () => {
    expectFail(await manual("12:00", "12:00"));
    expectFail(await manual("12:00", "09:00"));
    expect(await prisma.attendanceSession.count()).toBe(0);
  });

  it("jefe y admin no registran franjas manuales «propias»", async () => {
    await loginAs(world.users.jefe.email);
    expect(expectFail(await manual("08:00", "12:00"))).toMatch(/Solo los operarios/);
    expect(await prisma.attendanceSession.count()).toBe(0);
  });

  it("registrar la franja del día resuelve el aviso de «día incompleto» abierto al borrar un fichaje", async () => {
    unwrap(await manual("08:00", "12:00"));
    const s = await onlySessionOf(world.users.ana.id);
    unwrap(await deleteOwnAttendanceSession({ sessionId: s.id }));

    const scopeKey = `attendance-incomplete:${world.users.ana.id}:${DAY}`;
    let states = await prisma.notificationState.findMany({ where: { scopeKey } });
    expect(states.map((st) => st.userId).sort()).toEqual(managerIds());
    expect(states.every((st) => st.isActive)).toBe(true);

    unwrap(await manual("08:00", "14:00"));
    states = await prisma.notificationState.findMany({ where: { scopeKey } });
    expect(states.every((st) => !st.isActive && st.resolvedAt)).toBe(true);
  });
});

describe("correcciones del propio operario", () => {
  async function closedSession(startTime = "08:00", endTime = "14:00") {
    unwrap(await createManualAttendanceSession({ date: DAY, startTime, endTime }));
    return (await sessionsOf(world.users.ana.id)).find((s) => s.startedAt.getTime() === wall(startTime).getTime())!;
  }

  beforeEach(async () => {
    await loginAs(world.users.ana.email);
  });

  it("añadir, mover y borrar una pausa recalcula los minutos de la sesión cada vez", async () => {
    const s = await closedSession("08:00", "14:00");
    expect(s.minutes).toBe(360);

    unwrap(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "10:00", endTime: "10:30" }));
    expect((await onlySessionOf(world.users.ana.id)).minutes).toBe(330);

    const br = (await onlySessionOf(world.users.ana.id)).breaks[0]!;
    expect(br.source).toBe(AttendanceSource.MANUAL);
    unwrap(await updateOwnAttendanceBreak({ breakId: br.id, startTime: "10:00", endTime: "10:45" }));
    let after = await onlySessionOf(world.users.ana.id);
    expect(after.breaks[0]!.minutes).toBe(45);
    expect(after.minutes).toBe(315);
    await assertAttendanceConsistent();

    unwrap(await deleteOwnAttendanceBreak({ breakId: br.id }));
    after = await onlySessionOf(world.users.ana.id);
    expect(after.breaks).toHaveLength(0);
    expect(after.minutes).toBe(360);
  });

  it("rechaza pausas fuera de la sesión o solapadas con otra pausa, sin tocar los minutos", async () => {
    const s = await closedSession("08:00", "14:00");
    unwrap(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "10:00", endTime: "10:30" }));

    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "07:30", endTime: "08:30" })),
    ).toMatch(/antes del inicio/);
    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "13:30", endTime: "14:30" })),
    ).toMatch(/después del fin/);
    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "10:15", endTime: "11:00" })),
    ).toMatch(/se solapa/);

    // Mover la pausa existente sobre sí misma no es solape.
    const br = (await onlySessionOf(world.users.ana.id)).breaks[0]!;
    unwrap(await updateOwnAttendanceBreak({ breakId: br.id, startTime: "10:10", endTime: "10:40" }));

    const after = await onlySessionOf(world.users.ana.id);
    expect(after.breaks).toHaveLength(1);
    expect(after.minutes).toBe(330);
    await assertAttendanceConsistent();
  });

  it("no se pueden añadir pausas a mano a una sesión en vivo todavía abierta", async () => {
    unwrap(await startAttendance());
    const open = await onlySessionOf(world.users.ana.id);
    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: open.id, startTime: "08:00", endTime: "08:15" })),
    ).toMatch(/fichaje abierto/);
    expect(
      expectFail(
        await updateOwnAttendanceSession({ sessionId: open.id, date: DAY, startTime: "08:00", endTime: "12:00" }),
      ),
    ).toMatch(/fichaje abierto/);
    expect(await prisma.attendanceBreak.count()).toBe(0);
  });

  it("editar la franja recalcula minutos respetando sus pausas, y no deja dejar pausas fuera", async () => {
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "17:00", breakHandling: "took_break" }));
    const s = await onlySessionOf(world.users.ana.id);
    expect(s.minutes).toBe(480);

    unwrap(await updateOwnAttendanceSession({ sessionId: s.id, date: DAY, startTime: "07:30", endTime: "16:00" }));
    let after = await onlySessionOf(world.users.ana.id);
    expect(after.startedAt).toEqual(wall("07:30"));
    expect(after.minutes).toBe(8.5 * 60 - 60);
    expect(after.breaks).toHaveLength(1); // la comida 14–15 se conserva

    // Recortar hasta las 14:30 dejaría la comida (14–15) fuera de la sesión.
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: s.id, date: DAY, startTime: "08:00", endTime: "14:30" })),
    ).toMatch(/pausa no puede terminar después del fin/);
    after = await onlySessionOf(world.users.ana.id);
    expect(after.endedAt).toEqual(wall("16:00"));
    expect(after.minutes).toBe(450);
    await assertAttendanceConsistent();
  });

  it("editar no puede provocar solape con otra franja propia", async () => {
    await closedSession("08:00", "12:00");
    const late = await closedSession("12:00", "14:00");
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: late.id, date: DAY, startTime: "11:00", endTime: "13:00" })),
    ).toMatch(/se solapa/);
    const rows = await sessionsOf(world.users.ana.id);
    expect(rows[1]!.startedAt).toEqual(wall("12:00"));
    await assertAttendanceConsistent();
  });

  it("un operario no puede ver, editar, borrar ni tocar pausas de fichajes de otro", async () => {
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "17:00", breakHandling: "took_break" }));
    const anaSession = await onlySessionOf(world.users.ana.id);
    const anaBreak = anaSession.breaks[0]!;

    await loginAs(world.users.bea.email);
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: anaSession.id, date: DAY, startTime: "09:00", endTime: "10:00" })),
    ).toMatch(/no encontrada/);
    expect(expectFail(await deleteOwnAttendanceSession({ sessionId: anaSession.id }))).toMatch(/no encontrada/);
    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: anaSession.id, startTime: "09:00", endTime: "09:15" })),
    ).toMatch(/no encontrada/);
    expect(
      expectFail(await updateOwnAttendanceBreak({ breakId: anaBreak.id, startTime: "14:00", endTime: "14:30" })),
    ).toMatch(/no encontrada/);
    expect(expectFail(await deleteOwnAttendanceBreak({ breakId: anaBreak.id }))).toMatch(/no encontrada/);

    const range = await getAttendanceRange({ startDate: DAY, endDate: DAY });
    expect(range).toHaveLength(0);

    const untouched = await onlySessionOf(world.users.ana.id);
    expect(untouched.startedAt).toEqual(wall("08:00"));
    expect(untouched.minutes).toBe(480);
    expect(untouched.breaks).toHaveLength(1);
  });

  it("borrar un fichaje propio elimina sus pausas y avisa a los responsables de día incompleto", async () => {
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "17:00", breakHandling: "took_break" }));
    const s = await onlySessionOf(world.users.ana.id);
    unwrap(await deleteOwnAttendanceSession({ sessionId: s.id }));

    expect(await prisma.attendanceSession.count()).toBe(0);
    expect(await prisma.attendanceBreak.count()).toBe(0);
    const alerts = await notificationsOf(NotificationType.ATTENDANCE_INCOMPLETE_DAY);
    expect(alerts.map((n) => n.userId).sort()).toEqual(managerIds());
    expect(alerts[0]!.payload).toMatchObject({ userId: world.users.ana.id, personId: world.people.ana.id, dateIso: DAY });
  });

  it("jefe y admin no usan las acciones «propias» del operario", async () => {
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "12:00" }));
    const s = await onlySessionOf(world.users.ana.id);

    await loginAs(world.users.jefe.email);
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: s.id, date: DAY, startTime: "09:00", endTime: "10:00" })),
    ).toMatch(/Solo los operarios/);
    expect(expectFail(await deleteOwnAttendanceSession({ sessionId: s.id }))).toMatch(/Solo los operarios/);
    expect(
      expectFail(await createOwnAttendanceBreak({ sessionId: s.id, startTime: "09:00", endTime: "09:15" })),
    ).toMatch(/Solo los operarios/);
    expect(await onlySessionOf(world.users.ana.id)).toMatchObject({ minutes: 240 });
  });
});

describe("gestión del jefe / admin", () => {
  const adminRange = (personId: string, startTime: string, endTime: string, breakHandling?: "took_break" | "worked_extra") =>
    adminUpsertAttendanceSession({ personId, date: DAY, startTime, endTime, breakHandling });

  it("el jefe registra la jornada de un operario: queda a su nombre, marcada ADMIN_EDIT y con la comida", async () => {
    await loginAs(world.users.jefe.email);
    expect(expectFail(await adminRange(world.people.ana.id, "08:00", "17:00"))).toMatch(/cruza una franja de descanso/);
    unwrap(await adminRange(world.people.ana.id, "08:00", "17:00", "took_break"));

    const s = await onlySessionOf(world.users.ana.id);
    expect(s.personId).toBe(world.people.ana.id);
    expect(s.source).toBe(AttendanceSource.ADMIN_EDIT);
    expect(s.minutes).toBe(480);
    expect(s.breaks.map((b) => [b.startedAt, b.endedAt, b.source])).toEqual([
      [wall("14:00"), wall("15:00"), AttendanceSource.ADMIN_EDIT],
    ]);

    // La comprobación de solape es contra los fichajes de ESE operario.
    expect(expectFail(await adminRange(world.people.ana.id, "16:00", "18:00"))).toMatch(/se solapa/);
    unwrap(await adminRange(world.people.bea.id, "08:00", "12:00"));
    expect(await sessionsOf(world.users.bea.id)).toHaveLength(1);
    expect(await sessionsOf(world.users.jefe.id)).toHaveLength(0);
    await assertAttendanceConsistent();
  });

  it("no se puede registrar presencia de una persona sin usuario", async () => {
    const ghost = await prisma.person.create({
      data: { iniciales: "GHO", alias: "GHO", color: "#000000", personNaves: { create: { naveId: world.naves.n1.id } } },
    });
    await loginAs(world.users.admin.email);
    expect(expectFail(await adminRange(ghost.id, "08:00", "12:00"))).toMatch(/no tiene usuario vinculado/);
    expect(await prisma.attendanceSession.count()).toBe(0);
  });

  it("las pausas que añade/edita/borra el jefe recalculan los minutos de la sesión del operario", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "14:00" }));
    const s = await onlySessionOf(world.users.ana.id);

    await loginAs(world.users.jefe.email);
    unwrap(await adminCreateAttendanceBreak({ sessionId: s.id, startTime: "09:00", endTime: "09:20" }));
    let after = await onlySessionOf(world.users.ana.id);
    expect(after.minutes).toBe(340);
    expect(after.breaks[0]!.source).toBe(AttendanceSource.ADMIN_EDIT);

    expect(
      expectFail(await adminCreateAttendanceBreak({ sessionId: s.id, startTime: "09:10", endTime: "09:40" })),
    ).toMatch(/se solapa/);

    unwrap(await adminUpdateAttendanceBreak({ breakId: after.breaks[0]!.id, startTime: "09:00", endTime: "10:00" }));
    after = await onlySessionOf(world.users.ana.id);
    expect(after.minutes).toBe(300);
    await assertAttendanceConsistent();

    unwrap(await adminDeleteAttendanceBreak({ breakId: after.breaks[0]!.id }));
    expect((await onlySessionOf(world.users.ana.id)).minutes).toBe(360);
  });

  it("el jefe no puede meter pausas cerradas en una sesión en vivo abierta", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await startAttendance());
    const open = await onlySessionOf(world.users.ana.id);

    await loginAs(world.users.jefe.email);
    expect(
      expectFail(await adminCreateAttendanceBreak({ sessionId: open.id, startTime: "00:00", endTime: "00:01" })),
    ).toMatch(/sesión abierta/);
    expect(await prisma.attendanceBreak.count()).toBe(0);
  });

  it("un operario no puede usar ninguna acción de gestión (redirige y no cambia nada)", async () => {
    await loginAs(world.users.bea.email);
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "12:00" }));
    const beaSession = await onlySessionOf(world.users.bea.id);
    unwrap(await createOwnAttendanceBreak({ sessionId: beaSession.id, startTime: "10:00", endTime: "10:15" }));
    const beaBreak = (await onlySessionOf(world.users.bea.id)).breaks[0]!;

    await loginAs(world.users.ana.email);
    await expect(adminRange(world.people.ana.id, "08:00", "12:00")).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(adminDeleteAttendanceSession({ sessionId: beaSession.id })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(
      adminCreateAttendanceBreak({ sessionId: beaSession.id, startTime: "11:00", endTime: "11:15" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(
      adminUpdateAttendanceBreak({ breakId: beaBreak.id, startTime: "08:00", endTime: "12:00" }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(adminDeleteAttendanceBreak({ breakId: beaBreak.id })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await sessionsOf(world.users.ana.id)).toHaveLength(0);
    const untouched = await onlySessionOf(world.users.bea.id);
    expect(untouched.minutes).toBe(225);
    expect(untouched.breaks.map((b) => b.minutes)).toEqual([15]);
  });

  it("el jefe ve la presencia de todos y puede filtrar por persona; el operario solo la suya", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "12:00" }));
    unwrap(await createManualAttendanceSession({ date: NEXT_DAY, startTime: "08:00", endTime: "12:00" }));
    await loginAs(world.users.carl.email); // otra nave
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "09:00", endTime: "13:00" }));

    await loginAs(world.users.jefe.email);
    const all = await getAttendanceRange({ startDate: DAY, endDate: DAY });
    expect(all.map((s) => s.personId).sort()).toEqual([world.people.ana.id, world.people.carl.id].sort());
    const onlyAna = await getAttendanceRange({ startDate: DAY, endDate: NEXT_DAY, personId: world.people.ana.id });
    expect(onlyAna).toHaveLength(2);
    expect(onlyAna.every((s) => s.personId === world.people.ana.id)).toBe(true);

    await loginAs(world.users.ana.email);
    // Aunque pida la de Carl, el operario solo recibe la suya.
    const own = await getAttendanceRange({ startDate: DAY, endDate: NEXT_DAY, personId: world.people.carl.id });
    expect(own).toHaveLength(2);
    expect(own.every((s) => s.userId === world.users.ana.id)).toBe(true);
  });
});

describe("una sola convención horaria: botón y franjas manuales en instantes reales", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  /** Fija el reloj en una hora real (UTC) y vuelve a entrar, para que la sesión de better-auth sea válida. */
  async function at(isoUtc: string, email: string) {
    vi.setSystemTime(new Date(isoUtc));
    await loginAs(email);
  }
  const outsideAlerts = () => notificationsOf(NotificationType.ATTENDANCE_OUTSIDE_WORK_WINDOW);

  it("entrar puntual a las 08:00 de Madrid en verano no avisa de «fuera de horario» y se ve como 08:00", async () => {
    await at("2026-10-20T06:00:00.000Z", world.users.ana.email); // 08:00 CEST
    unwrap(await startAttendance());
    expect(await outsideAlerts()).toHaveLength(0);
    const s = await onlySessionOf(world.users.ana.id);
    expect(madridHhmm(s.startedAt)).toBe("08:00");
  });

  it("entrar puntual a las 08:00 de Madrid en invierno no avisa; a las 07:00 o en la comida sí", async () => {
    await at("2026-10-26T07:00:00.000Z", world.users.ana.email); // lunes 08:00 CET
    unwrap(await startAttendance());
    expect(await outsideAlerts()).toHaveLength(0);
    vi.setSystemTime(new Date("2026-10-26T12:00:00.000Z"));
    unwrap(await stopAttendance());

    await at("2026-10-26T13:30:00.000Z", world.users.ana.email); // 14:30 CET: hueco de comida
    unwrap(await startAttendance());
    let alerts = await outsideAlerts();
    expect(alerts.map((n) => n.userId).sort()).toEqual(managerIds());
    expect(alerts[0]!.payload).toMatchObject({ dateIso: "2026-10-26", atIso: "2026-10-26T13:30:00.000Z" });
    vi.setSystemTime(new Date("2026-10-26T15:00:00.000Z"));
    unwrap(await stopAttendance());

    await at("2026-10-27T06:00:00.000Z", world.users.bea.email); // 07:00 CET: antes de su jornada
    unwrap(await startAttendance());
    alerts = await outsideAlerts();
    expect(alerts.filter((n) => (n.payload as { userId: string }).userId === world.users.bea.id)).toHaveLength(2);
  });

  it("fichar con el botón y registrar a mano no pueden solaparse, en ningún orden", async () => {
    await at(`${DAY}T13:00:00.000Z`, world.users.ana.email); // 15:00 en Madrid
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "14:00" }));
    unwrap(await startAttendance()); // 15:00 no choca con 08–14
    vi.setSystemTime(new Date(`${DAY}T15:00:00.000Z`)); // 17:00
    unwrap(await stopAttendance());

    // La sesión del botón (15:00–17:00 en Madrid) se detecta como solape de una franja manual.
    expect(
      expectFail(await createManualAttendanceSession({ date: DAY, startTime: "16:00", endTime: "18:00" })),
    ).toMatch(/se solapa/);
    // Pegada al final, no.
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "17:00", endTime: "17:30" }));

    // Y al revés: si ya hay una franja manual que cubre ahora, no se puede pulsar «Entrar».
    await at(`${NEXT_DAY}T10:00:00.000Z`, world.users.ana.email); // 12:00 en Madrid
    unwrap(
      await createManualAttendanceSession({ date: NEXT_DAY, startTime: "08:00", endTime: "13:00" }),
    );
    expect(expectFail(await startAttendance())).toMatch(/cubre esta hora/);

    expect((await sessionsOf(world.users.ana.id)).map((s) => [madridHhmm(s.startedAt), madridHhmm(s.endedAt!)])).toEqual([
      ["08:00", "14:00"],
      ["15:00", "17:00"],
      ["17:00", "17:30"],
      ["08:00", "13:00"],
    ]);
    await assertAttendanceConsistent();
  });

  it("el jefe no puede registrar una franja que pise el fichaje en vivo abierto del operario", async () => {
    await at(`${DAY}T06:00:00.000Z`, world.users.ana.email); // entra a las 08:00
    unwrap(await startAttendance());

    await at(`${DAY}T10:00:00.000Z`, world.users.jefe.email);
    expect(
      expectFail(await adminUpsertAttendanceSession({ personId: world.people.ana.id, date: DAY, startTime: "09:00", endTime: "11:00" })),
    ).toMatch(/fichaje en vivo abierto/);
    // Antes de la entrada sí.
    unwrap(await adminUpsertAttendanceSession({ personId: world.people.ana.id, date: DAY, startTime: "06:00", endTime: "07:30" }));

    // El operario tampoco puede estirar esa franja hasta dentro de su sesión abierta.
    await loginAs(world.users.ana.email);
    const early = (await sessionsOf(world.users.ana.id)).find((s) => s.source === AttendanceSource.ADMIN_EDIT)!;
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: early.id, date: DAY, startTime: "06:00", endTime: "09:00" })),
    ).toMatch(/fichaje en vivo abierto/);

    const rows = await sessionsOf(world.users.ana.id);
    expect(rows).toHaveLength(2);
    expect(rows.find((s) => s.id === early.id)!.endedAt).toEqual(wall("07:30"));
  });

  it("no se registra presencia en días futuros (hoy, a horas posteriores, sí)", async () => {
    await at(`${DAY}T08:00:00.000Z`, world.users.ana.email); // 10:00 en Madrid
    unwrap(await createManualAttendanceSession({ date: DAY, startTime: "15:00", endTime: "17:00" }));
    expect(
      expectFail(await createManualAttendanceSession({ date: NEXT_DAY, startTime: "08:00", endTime: "12:00" })),
    ).toMatch(/días futuros/);
    const s = await onlySessionOf(world.users.ana.id);
    expect(
      expectFail(await updateOwnAttendanceSession({ sessionId: s.id, date: NEXT_DAY, startTime: "08:00", endTime: "10:00" })),
    ).toMatch(/días futuros/);

    await loginAs(world.users.jefe.email);
    expect(
      expectFail(await adminUpsertAttendanceSession({ personId: world.people.bea.id, date: NEXT_DAY, startTime: "08:00", endTime: "12:00" })),
    ).toMatch(/días futuros/);

    expect(await prisma.attendanceSession.count()).toBe(1);
    expect((await onlySessionOf(world.users.ana.id)).startedAt).toEqual(wall("15:00"));
  });

  it("«hoy» es el día de Madrid: a las 00:30 de Madrid (22:30Z del día anterior) ya se puede registrar ese día", async () => {
    await at(`${DAY}T22:30:00.000Z`, world.users.ana.email);
    unwrap(await createManualAttendanceSession({ date: NEXT_DAY, startTime: "00:00", endTime: "00:30" }));
    expect((await onlySessionOf(world.users.ana.id)).startedAt.toISOString()).toBe(`${DAY}T22:00:00.000Z`);
  });
});

describe("migración de fichajes antiguos a instantes reales", () => {
  const MIGRATION_SQL = readFileSync(
    join(process.cwd(), "prisma/migrations/20261027120000_attendance_real_instants/migration.sql"),
    "utf8",
  );
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it("convierte las franjas en hora mural (verano e invierno, con sus pausas), respeta las del botón y es idempotente", async () => {
    const ana = { userId: world.users.ana.id, personId: world.people.ana.id };
    // Filas con la forma exacta que producía la app antes del cambio (no hay ya action que las genere).
    const manualSummer = await prisma.attendanceSession.create({
      data: {
        ...ana,
        source: AttendanceSource.MANUAL,
        startedAt: new Date("2026-07-20T08:00:00.000Z"),
        endedAt: new Date("2026-07-20T17:00:00.000Z"),
        minutes: 480,
        breaks: {
          create: {
            source: AttendanceSource.MANUAL,
            startedAt: new Date("2026-07-20T14:00:00.000Z"),
            endedAt: new Date("2026-07-20T15:00:00.000Z"),
            minutes: 60,
          },
        },
      },
    });
    const adminWinter = await prisma.attendanceSession.create({
      data: {
        ...ana,
        source: AttendanceSource.ADMIN_EDIT,
        startedAt: new Date("2026-01-20T08:00:00.000Z"),
        endedAt: new Date("2026-01-20T12:00:00.000Z"),
        minutes: 240,
      },
    });
    const buttonLive = await prisma.attendanceSession.create({
      data: {
        ...ana,
        source: AttendanceSource.BUTTON,
        startedAt: new Date("2026-07-21T06:03:17.123Z"),
        endedAt: new Date("2026-07-21T14:01:05.456Z"),
        minutes: 433,
        breaks: {
          create: [
            {
              source: AttendanceSource.BUTTON,
              startedAt: new Date("2026-07-21T08:00:01.500Z"),
              endedAt: new Date("2026-07-21T08:15:02.250Z"),
              minutes: 15,
            },
            // Pausa añadida después a mano (hora mural 13:00–13:30) sobre la sesión del botón.
            {
              source: AttendanceSource.MANUAL,
              startedAt: new Date("2026-07-21T13:00:00.000Z"),
              endedAt: new Date("2026-07-21T13:30:00.000Z"),
              minutes: 30,
            },
          ],
        },
      },
    });
    // Sesión del botón editada después por el operario: conserva source BUTTON pero va en hora mural.
    const buttonEdited = await prisma.attendanceSession.create({
      data: {
        ...ana,
        source: AttendanceSource.BUTTON,
        startedAt: new Date("2026-07-22T08:00:00.000Z"),
        endedAt: new Date("2026-07-22T10:00:00.000Z"),
        minutes: 120,
      },
    });
    const buttonOpen = await prisma.attendanceSession.create({
      data: { ...ana, source: AttendanceSource.BUTTON, startedAt: new Date("2026-10-20T06:00:00.000Z") },
    });

    const snapshot = async () => {
      const rows = await prisma.attendanceSession.findMany({
        include: { breaks: { orderBy: { startedAt: "asc" } } },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const view = (id: string) => {
        const r = byId.get(id)!;
        return {
          s: [iso(r.startedAt), iso(r.endedAt), r.minutes],
          b: r.breaks.map((b) => [iso(b.startedAt), iso(b.endedAt), b.minutes]),
        };
      };
      return {
        manualSummer: view(manualSummer.id),
        adminWinter: view(adminWinter.id),
        buttonLive: view(buttonLive.id),
        buttonEdited: view(buttonEdited.id),
        buttonOpen: view(buttonOpen.id),
      };
    };
    const expected = {
      manualSummer: {
        s: ["2026-07-20T06:00:00.000Z", "2026-07-20T15:00:00.000Z", 480],
        b: [["2026-07-20T12:00:00.000Z", "2026-07-20T13:00:00.000Z", 60]],
      },
      adminWinter: { s: ["2026-01-20T07:00:00.000Z", "2026-01-20T11:00:00.000Z", 240], b: [] },
      buttonLive: {
        s: ["2026-07-21T06:03:17.123Z", "2026-07-21T14:01:05.456Z", 433],
        b: [
          ["2026-07-21T08:00:01.500Z", "2026-07-21T08:15:02.250Z", 15],
          ["2026-07-21T11:00:00.000Z", "2026-07-21T11:30:00.000Z", 30],
        ],
      },
      buttonEdited: { s: ["2026-07-22T06:00:00.000Z", "2026-07-22T08:00:00.000Z", 120], b: [] },
      buttonOpen: { s: ["2026-10-20T06:00:00.000Z", null, null], b: [] },
    };

    // La BD de test ya tiene la migración aplicada (y marcada): se quita la marca para simular la BD antigua.
    await prisma.$executeRawUnsafe(`COMMENT ON TABLE "AttendanceSession" IS NULL`);
    await prisma.$executeRawUnsafe(MIGRATION_SQL);
    expect(await snapshot()).toEqual(expected);
    // En hora de Madrid, la franja de verano vuelve a leerse 08:00–17:00 con comida 14:00.
    const migrated = await onlySessionById(manualSummer.id);
    expect([madridHhmm(migrated.startedAt), madridHhmm(migrated.endedAt!), madridHhmm(migrated.breaks[0]!.startedAt)]).toEqual([
      "08:00",
      "17:00",
      "14:00",
    ]);

    await prisma.$executeRawUnsafe(MIGRATION_SQL);
    expect(await snapshot(), "una segunda ejecución no debe volver a desplazar nada").toEqual(expected);
  });

  async function onlySessionById(id: string) {
    return prisma.attendanceSession.findUniqueOrThrow({
      where: { id },
      include: { breaks: { orderBy: { startedAt: "asc" } } },
    });
  }
});

describe("presencia y registro de horas comparten la misma regla de comida", () => {
  it("8–17 con descanso son 8h tanto en el fichaje de presencia como en las horas de la tarea", async () => {
    const lamp = await createPlannableLamp(world);
    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;

    await loginAs(world.users.ana.email);
    unwrap(
      await createManualAttendanceSession({ date: DAY, startTime: "08:00", endTime: "17:00", breakHandling: "took_break" }),
    );

    // Mis horas trabaja con instantes reales: 08:00–17:00 en Madrid (CEST, UTC+2) = 06:00Z–15:00Z.
    const hoursRange = {
      projectId: lamp.projectId,
      lampId: lamp.lampId,
      taskId: cnc.id,
      process: "CNC",
      ranges: [{ startedAt: `${DAY}T06:00:00.000Z`, endedAt: `${DAY}T15:00:00.000Z` }],
    };
    expect(expectFail(await createManualEntriesFromRanges(hoursRange))).toMatch(/cruza una franja de descanso/);
    unwrap(await createManualEntriesFromRanges({ ...hoursRange, breakHandling: "took_break" }));

    const entries = await prisma.timeEntry.findMany({ where: { userId: world.users.ana.id }, orderBy: { startedAt: "asc" } });
    const loggedHours = entries.reduce((acc, e) => acc + (e.hours ?? 0), 0);
    const attendance = await onlySessionOf(world.users.ana.id);

    expect(loggedHours).toBeCloseTo(8);
    expect(attendance.minutes).toBe(8 * 60);
    // El hueco que deja Mis horas es la misma comida 14–15 (hora de Madrid) que la pausa de presencia.
    expect(entries.map((e) => [e.startedAt.toISOString(), e.endedAt!.toISOString()])).toEqual([
      [`${DAY}T06:00:00.000Z`, `${DAY}T12:00:00.000Z`],
      [`${DAY}T13:00:00.000Z`, `${DAY}T15:00:00.000Z`],
    ]);
    expect(attendance.breaks.map((b) => [b.startedAt, b.endedAt])).toEqual([[wall("14:00"), wall("15:00")]]);
  });
});
