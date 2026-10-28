import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PlanningStatus,
  ProjectKind,
  TaskSystemKind,
  type PlanningAssignment,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import {
  createAdHocTask,
  deleteAdHocTask,
  listPendingAdHocTasks,
  updateAdHocTask,
} from "@/features/ad-hoc/actions";
import { IMPREVISTAS_POOL_PROJECT_CODE } from "@/features/ad-hoc/imprevistas-pool";
import { generatePlanning } from "@/features/planning/service";
import { publishPlanningAction, undoPlanningAction } from "@/features/planning/actions";
import {
  completeTask,
  createManualEntry,
  createManualEntryForTask,
  startTimer,
} from "@/features/time-tracking/actions";
import { createProject, toggleProjectActive } from "@/features/projects/actions";
import { savePerson, savePersonWorkWindows, setAbsence } from "@/features/people/actions";
import { createHoliday } from "@/features/holidays/actions";
import {
  buildWorld,
  createPlannableLamp,
  expectFail,
  loginAs,
  unwrap,
  type World,
} from "@/test/integration/world";

const DAY_MS = 86_400_000;
// Semana que viene + 1: siempre futura, sin fichajes dentro.
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const WEEK_ISO = WEEK.toISOString().slice(0, 10);
const NEXT_WEEK = new Date(WEEK.getTime() + 7 * DAY_MS);
const dayOf = (offset: number) => new Date(WEEK.getTime() + offset * DAY_MS);
const isoDay = (offset: number) => dayOf(offset).toISOString().slice(0, 10);
// Fichajes de imprevistas en un martes ya pasado (la UI no deja fichar en el futuro).
const PAST = "2026-10-20";

type AdHocInput = Parameters<typeof createAdHocTask>[0];

let world: World;

beforeEach(async () => {
  world = await buildWorld();
  // Dato de producción creado por la migración 20260704120001 (el TRUNCATE lo borra).
  await prisma.project.create({
    data: {
      code: IMPREVISTAS_POOL_PROJECT_CODE,
      name: "Pool de imprevistas",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.IMPREVISTAS,
    },
  });
});

/** Proyecto sin lámparas, como los de mantenimiento/oficina que la UI ofrece en el selector. */
async function projectWithoutLamps(name = "Mantenimiento") {
  await loginAs(world.users.admin.email);
  return createProject({ name, kind: ProjectKind.PRODUCCION, isBillable: false });
}

/** El jefe de producción crea la imprevista desde el diálogo de la semana. */
async function newAdHoc(input: Partial<AdHocInput> & { projectId: string }) {
  await loginAs(world.users.jefe.email);
  return createAdHocTask({
    personIds: [world.people.ana.id],
    estimatedHours: 2,
    notes: "Rehacer embalaje",
    internalNotes: "Golpe en transporte",
    ...input,
  });
}

async function editAdHoc(taskId: string, input: Partial<AdHocInput>) {
  const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { participants: true } });
  await loginAs(world.users.jefe.email);
  return updateAdHocTask({
    taskId,
    personIds: t.participants.map((p) => p.personId),
    estimatedHours: t.estimatedHours,
    notes: t.notes ?? "",
    internalNotes: t.internalNotes ?? "",
    projectId: t.projectId,
    process: t.process,
    ...input,
  });
}

async function pendingIds(naveScope: string[] | null = null) {
  await loginAs(world.users.jefe.email);
  return (await listPendingAdHocTasks(naveScope)).map((r) => r.id);
}

async function participantsOf(taskId: string) {
  const rows = await prisma.taskParticipant.findMany({ where: { taskId } });
  return rows.map((r) => r.personId).sort();
}

/** Ana ficha 1h en la imprevista (como en «Mis horas»). */
async function anaLogsHour(taskId: string) {
  const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  await loginAs(world.users.ana.email);
  unwrap(
    await createManualEntry({
      projectId: t.projectId,
      lampId: t.lampId,
      taskId,
      process: t.process,
      startedAt: `${PAST}T08:00:00.000Z`,
      hours: 1,
    }),
  );
}

async function assignments(where: { taskId?: string } = {}): Promise<PlanningAssignment[]> {
  return prisma.planningAssignment.findMany({ where, orderBy: [{ date: "asc" }, { startSlot: "asc" }] });
}

/** Invariante: nadie está en dos sitios a la vez. */
function assertNoOverlaps(rows: PlanningAssignment[]) {
  for (const [i, a] of rows.entries()) {
    for (const b of rows.slice(i + 1)) {
      if (a.personId !== b.personId || a.date.getTime() !== b.date.getTime()) continue;
      const overlap = a.startSlot < b.endSlot && b.startSlot < a.endSlot;
      expect(overlap, `solape de ${a.personId} el ${a.date.toISOString()}`).toBe(false);
    }
  }
}

/** Una imprevista se coloca a la vez para todos sus participantes, con sus horas completas. */
function assertPlacedTogether(rows: PlanningAssignment[], participantIds: string[], hours: number) {
  expect(rows.map((r) => r.personId).sort()).toEqual([...participantIds].sort());
  const [first] = rows;
  for (const r of rows) {
    expect(r.date.getTime()).toBe(first!.date.getTime());
    expect([r.startSlot, r.endSlot]).toEqual([first!.startSlot, first!.endSlot]);
    expect(r.endSlot - r.startSlot).toBeCloseTo(hours);
    expect(r.hours).toBe(hours);
    expect(r.isOverride).toBe(true);
  }
}

const plan = (weekStart = WEEK) =>
  generatePlanning({ naveId: world.naves.n1.id, weekStart, planFrom: "WEEK_START" });

describe("crear imprevista", () => {
  it("en un proyecto con lámpara: cuelga de su primera lámpara, nave de los operarios y participantes sin duplicar", async () => {
    const lamp = await createPlannableLamp(world);
    const res = unwrap(
      await newAdHoc({
        projectId: lamp.projectId,
        personIds: [world.people.ana.id, world.people.bea.id, world.people.ana.id],
        notes: "  Rehacer embalaje  ",
        internalNotes: "  Golpe en transporte ",
      }),
    );
    expect(res.scheduledInPlanning).toBe(false); // no hay borrador de esta semana

    const t = await prisma.task.findUniqueOrThrow({ where: { id: res.taskId } });
    const maxCatalogOrder = Math.max(...lamp.tasks.map((x) => x.order));
    expect(t).toMatchObject({
      systemKind: TaskSystemKind.AD_HOC,
      process: "IMPREVISTA",
      projectId: lamp.projectId,
      lampId: lamp.lampId,
      lampElementId: null,
      naveId: world.naves.n1.id,
      estimatedHours: 2,
      notes: "Rehacer embalaje",
      internalNotes: "Golpe en transporte",
      createdByUserId: world.users.jefe.id,
      isCompleted: false,
      workOrderId: null,
      order: maxCatalogOrder + 1,
    });
    expect(await participantsOf(t.id)).toEqual([world.people.ana.id, world.people.bea.id].sort());
    // Las tareas de catálogo no se tocan.
    expect(await prisma.task.count({ where: { lampId: lamp.lampId } })).toBe(lamp.tasks.length + 1);

    expect(await pendingIds()).toEqual([t.id]);
  });

  it("en un proyecto sin lámparas: va a la lámpara «Imprevistas» del pool, que se crea una vez y se reutiliza", async () => {
    const project = await projectWithoutLamps();
    const a = unwrap(await newAdHoc({ projectId: project.id }));
    const b = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.bea.id] }));

    const pool = await prisma.project.findUniqueOrThrow({
      where: { code: IMPREVISTAS_POOL_PROJECT_CODE },
      include: { lamps: true },
    });
    expect(pool.lamps.map((l) => l.nameKey)).toEqual(["imprevistas"]);
    const tasks = await prisma.task.findMany({ where: { id: { in: [a.taskId, b.taskId] } }, orderBy: { order: "asc" } });
    for (const t of tasks) {
      expect(t.lampId).toBe(pool.lamps[0]!.id);
      // El proyecto imputable sigue siendo el elegido, no el pool.
      expect(t.projectId).toBe(project.id);
    }
    expect(tasks.map((t) => t.order)).toEqual([1, 2]);
    expect(await prisma.lamp.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("acepta otro proceso del catálogo, pero no uno inexistente", async () => {
    const project = await projectWithoutLamps();
    const ok = unwrap(await newAdHoc({ projectId: project.id, process: "PINTURA", personIds: [world.people.bea.id] }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: ok.taskId } })).process).toBe("PINTURA");

    expect(expectFail(await newAdHoc({ projectId: project.id, process: "SOLDADURA" }))).toMatch(/Proceso no encontrado/);
    expect(await prisma.task.count({ where: { systemKind: TaskSystemKind.AD_HOC } })).toBe(1);
  });

  it("solo jefe de producción o admin: un operario es redirigido y no se crea nada", async () => {
    const project = await projectWithoutLamps();
    await loginAs(world.users.ana.email);
    await expect(
      createAdHocTask({
        personIds: [world.people.ana.id],
        estimatedHours: 1,
        notes: "x",
        internalNotes: "y",
        projectId: project.id,
      }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(listPendingAdHocTasks(null)).rejects.toThrow(/NEXT_REDIRECT/);

    await loginAs(world.users.admin.email);
    unwrap(
      await createAdHocTask({
        personIds: [world.people.ana.id],
        estimatedHours: 1,
        notes: "x",
        internalNotes: "y",
        projectId: project.id,
      }),
    );
    expect(await prisma.task.count({ where: { systemKind: TaskSystemKind.AD_HOC } })).toBe(1);
  });

  it("rechaza operarios de naves distintas, una nave que no es la suya, personas inactivas y proyectos archivados", async () => {
    const project = await projectWithoutLamps();
    const { ana, carl } = world.people;

    expect(expectFail(await newAdHoc({ projectId: project.id, personIds: [ana.id, carl.id] }))).toMatch(/misma nave/);
    expect(
      expectFail(await newAdHoc({ projectId: project.id, personIds: [ana.id], naveId: world.naves.n2.id })),
    ).toMatch(/no pertenecen a la nave/);

    // Baja de Carl desde Personal.
    await loginAs(world.users.admin.email);
    unwrap(
      await savePerson({
        id: carl.id,
        iniciales: "CRL",
        color: "#000000",
        hourlyRate: 14.75,
        overtimeHourlyRate: 22.13,
        isActive: false,
        naveIds: [world.naves.n2.id],
        userId: world.users.carl.id,
        specialties: [],
      }),
    );
    expect(expectFail(await newAdHoc({ projectId: project.id, personIds: [carl.id] }))).toMatch(/Persona no encontrada/);

    await loginAs(world.users.admin.email);
    await toggleProjectActive({ projectId: project.id, isActive: false });
    expect(expectFail(await newAdHoc({ projectId: project.id }))).toMatch(/Proyecto no encontrado/);

    // Observación vacía (solo espacios) tampoco vale.
    await loginAs(world.users.admin.email);
    await toggleProjectActive({ projectId: project.id, isActive: true });
    expect(expectFail(await newAdHoc({ projectId: project.id, notes: "   " }))).toMatch(/observación/);

    expect(await prisma.task.count({ where: { systemKind: TaskSystemKind.AD_HOC } })).toBe(0);
    expect(await prisma.taskParticipant.count()).toBe(0);
  });

  it("un operario puede fichar su imprevista sin esperar a la cadena de procesos, pero no uno de otra nave", async () => {
    const lamp = await createPlannableLamp(world);
    const { taskId } = unwrap(await newAdHoc({ projectId: lamp.projectId }));
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const entry = {
      projectId: t.projectId,
      lampId: t.lampId,
      taskId,
      process: "IMPREVISTA",
      startedAt: `${PAST}T08:00:00.000Z`,
      hours: 1,
    };

    // El CNC de la lámpara aún no está completado y aun así la imprevista no está bloqueada.
    await loginAs(world.users.ana.email);
    unwrap(await createManualEntry(entry));

    await loginAs(world.users.carl.email);
    expect(expectFail(await createManualEntry({ ...entry, startedAt: `${PAST}T10:00:00.000Z` }))).toMatch(/nave/);

    const entries = await prisma.timeEntry.findMany({ where: { taskId } });
    expect(entries.map((e) => [e.userId, e.hours])).toEqual([[world.users.ana.id, 1]]);
  });

  it("la lista de pendientes respeta el ámbito de nave", async () => {
    const project = await projectWithoutLamps();
    const n1 = unwrap(await newAdHoc({ projectId: project.id }));
    const n2 = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.carl.id] }));

    expect(await pendingIds([world.naves.n1.id])).toEqual([n1.taskId]);
    expect(await pendingIds([world.naves.n2.id])).toEqual([n2.taskId]);
    expect((await pendingIds(null)).sort()).toEqual([n1.taskId, n2.taskId].sort());
    expect(await pendingIds([])).toEqual([]);
  });
});

describe("editar imprevista pendiente", () => {
  it("sin fichajes cambia operarios, horas, proceso, proyecto (y su lámpara) y textos", async () => {
    const lamp = await createPlannableLamp(world);
    const other = await projectWithoutLamps("Oficina");
    const { taskId } = unwrap(await newAdHoc({ projectId: lamp.projectId }));

    unwrap(
      await editAdHoc(taskId, {
        personIds: [world.people.bea.id],
        estimatedHours: 3.5,
        process: "PINTURA",
        projectId: other.id,
        notes: "Repintar marco",
        internalNotes: "Error de color",
      }),
    );

    const pool = await prisma.project.findUniqueOrThrow({
      where: { code: IMPREVISTAS_POOL_PROJECT_CODE },
      include: { lamps: true },
    });
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(t).toMatchObject({
      projectId: other.id,
      lampId: pool.lamps[0]!.id,
      process: "PINTURA",
      estimatedHours: 3.5,
      naveId: world.naves.n1.id,
      notes: "Repintar marco",
      internalNotes: "Error de color",
      systemKind: TaskSystemKind.AD_HOC,
    });
    expect(await participantsOf(taskId)).toEqual([world.people.bea.id]);

    // Pasar a Carl la mueve a su nave.
    unwrap(await editAdHoc(taskId, { personIds: [world.people.carl.id] }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).naveId).toBe(world.naves.n2.id);
    expect(await participantsOf(taskId)).toEqual([world.people.carl.id]);
  });

  it("con horas fichadas solo deja cambiar los textos; lo estructural se rechaza sin tocar nada", async () => {
    const project = await projectWithoutLamps();
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.ana.id, world.people.bea.id] }));
    await anaLogsHour(taskId);
    const before = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    for (const change of [
      { estimatedHours: 5 },
      { personIds: [world.people.ana.id] },
      { process: "CNC" },
      { projectId: (await projectWithoutLamps("Otro")).id },
    ]) {
      expect(expectFail(await editAdHoc(taskId, { ...change, notes: "cambiada" })), JSON.stringify(change)).toMatch(
        /horas fichadas/,
      );
    }
    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(unchanged).toEqual(before);
    expect(await participantsOf(taskId)).toEqual([world.people.ana.id, world.people.bea.id].sort());

    unwrap(await editAdHoc(taskId, { notes: "Nueva observación", internalNotes: "Nuevo motivo" }));
    const after = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.notes).toBe("Nueva observación");
    expect(after.internalNotes).toBe("Nuevo motivo");
    expect(after.estimatedHours).toBe(before.estimatedHours);
    expect(await participantsOf(taskId)).toEqual([world.people.ana.id, world.people.bea.id].sort());
  });

  it("no edita una imprevista completada ni una tarea de catálogo", async () => {
    const lamp = await createPlannableLamp(world);
    const { taskId } = unwrap(await newAdHoc({ projectId: lamp.projectId }));
    await loginAs(world.users.ana.email);
    unwrap(await completeTask({ taskId }));
    expect(expectFail(await editAdHoc(taskId, { notes: "otra" }))).toMatch(/completada/);
    expect(await pendingIds()).toEqual([]);

    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;
    await loginAs(world.users.jefe.email);
    const res = await updateAdHocTask({
      taskId: cnc.id,
      personIds: [world.people.ana.id],
      estimatedHours: 0.5,
      notes: "x",
      internalNotes: "y",
      projectId: lamp.projectId,
      process: "CNC",
    });
    expect(expectFail(res)).toMatch(/Solo se pueden editar tareas imprevistas/);
    const untouched = await prisma.task.findUniqueOrThrow({ where: { id: cnc.id } });
    expect(untouched.estimatedHours).toBe(cnc.estimatedHours);
    expect(untouched.systemKind).toBeNull();
    expect(await prisma.taskParticipant.count({ where: { taskId: cnc.id } })).toBe(0);
  });
});

describe("eliminar imprevista", () => {
  it("borra la pendiente con sus participantes; no deja borrar con fichajes ni tareas de catálogo", async () => {
    const lamp = await createPlannableLamp(world);
    const a = unwrap(await newAdHoc({ projectId: lamp.projectId, personIds: [world.people.ana.id, world.people.bea.id] }));
    const b = unwrap(await newAdHoc({ projectId: lamp.projectId }));
    await anaLogsHour(b.taskId);

    await loginAs(world.users.jefe.email);
    unwrap(await deleteAdHocTask({ taskId: a.taskId }));
    expect(await prisma.task.findUnique({ where: { id: a.taskId } })).toBeNull();
    expect(await prisma.taskParticipant.count({ where: { taskId: a.taskId } })).toBe(0);

    expect(expectFail(await deleteAdHocTask({ taskId: b.taskId }))).toMatch(/horas fichadas/);
    expect(await prisma.task.findUnique({ where: { id: b.taskId } })).not.toBeNull();
    expect(await prisma.timeEntry.count({ where: { taskId: b.taskId } })).toBe(1);

    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;
    expect(expectFail(await deleteAdHocTask({ taskId: cnc.id }))).toMatch(/Solo se pueden eliminar tareas imprevistas/);
    expect(await prisma.task.count({ where: { lampId: lamp.lampId, systemKind: null } })).toBe(lamp.tasks.length);

    await loginAs(world.users.ana.email);
    await expect(deleteAdHocTask({ taskId: b.taskId })).rejects.toThrow(/NEXT_REDIRECT/);
  });
});

describe("imprevistas en el planning", () => {
  it("se colocan a la vez para todos sus participantes, sin pisar el trabajo del solver", async () => {
    const lamp = await createPlannableLamp(world); // CNC 2h (Ana) → ENSAMBLAJE 2h → PINTURA 0.8h (Bea)
    const { taskId } = unwrap(
      await newAdHoc({ projectId: lamp.projectId, personIds: [world.people.ana.id, world.people.bea.id], estimatedHours: 3 }),
    );

    const result = await plan();
    expect(result.unscheduledHours).toBe(0);
    const rows = await assignments();
    const adHocRows = rows.filter((r) => r.taskId === taskId);
    assertPlacedTogether(adHocRows, [world.people.ana.id, world.people.bea.id], 3);
    expect(adHocRows[0]!.process).toBe("IMPREVISTA");
    expect(adHocRows[0]!.date.getTime()).toBeGreaterThanOrEqual(WEEK.getTime());
    expect(adHocRows[0]!.date.getTime()).toBeLessThan(dayOf(5).getTime());
    expect(adHocRows[0]!.endSlot).toBeLessThanOrEqual(8);
    // El catálogo sigue planificado entero.
    for (const t of lamp.tasks) expect(rows.some((r) => r.taskId === t.id), t.process).toBe(true);
    assertNoOverlaps(rows);

    // Ya no está pendiente y no se puede editar, pero sí borrar (y se va del planning).
    expect(await pendingIds()).toEqual([]);
    expect(expectFail(await editAdHoc(taskId, { notes: "otra" }))).toMatch(/ya está en el planning/);
    await loginAs(world.users.jefe.email);
    unwrap(await deleteAdHocTask({ taskId }));
    expect(await assignments({ taskId })).toEqual([]);
    expect(await prisma.planningAssignment.count()).toBe(rows.length - adHocRows.length);
  });

  it("con solo imprevistas también se genera el planning, y solo con las de esa nave", async () => {
    const project = await projectWithoutLamps();
    const n1 = unwrap(await newAdHoc({ projectId: project.id }));
    const n2 = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.carl.id] }));

    const result = await plan();
    expect(result.assignmentsCount).toBe(1);
    const rows = await assignments();
    assertPlacedTogether(rows, [world.people.ana.id], 2);
    expect(rows[0]!.taskId).toBe(n1.taskId);
    expect(await pendingIds()).toEqual([n2.taskId]);
  });

  it("regenerar la semana conserva la colocación de la imprevista; deshacer la devuelve a pendientes y editable", async () => {
    const lamp = await createPlannableLamp(world);
    const { taskId } = unwrap(await newAdHoc({ projectId: lamp.projectId, personIds: [world.people.bea.id] }));

    await plan();
    const first = (await assignments({ taskId })).map((r) => [r.personId, r.date.getTime(), r.startSlot, r.endSlot]);
    expect(first).toHaveLength(1);
    await plan();
    const second = (await assignments({ taskId })).map((r) => [r.personId, r.date.getTime(), r.startSlot, r.endSlot]);
    expect(second).toEqual(first);
    assertNoOverlaps(await assignments());

    await loginAs(world.users.admin.email);
    expect(unwrap(await undoPlanningAction({ weekStart: WEEK_ISO })).deletedCount).toBe(1);
    expect(await pendingIds()).toEqual([taskId]);
    unwrap(await editAdHoc(taskId, { estimatedHours: 1 }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).estimatedHours).toBe(1);
  });

  it("una imprevista completada no se planifica", async () => {
    const lamp = await createPlannableLamp(world);
    const { taskId } = unwrap(await newAdHoc({ projectId: lamp.projectId }));
    await loginAs(world.users.ana.email);
    unwrap(await completeTask({ taskId }));

    await plan();
    expect(await assignments({ taskId })).toEqual([]);
  });

  it("una imprevista ya colocada en el borrador de una semana no se vuelve a colocar en la siguiente", async () => {
    const project = await projectWithoutLamps();
    const placed = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.bea.id] }));

    await plan(WEEK);
    expect(await assignments({ taskId: placed.taskId })).toHaveLength(1);
    // Llega otra imprevista después: la semana siguiente sí tiene algo que colocar.
    const later = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.ana.id] }));
    await plan(NEXT_WEEK);

    const rows = await assignments({ taskId: placed.taskId });
    expect(rows, "la imprevista está colocada en dos semanas a la vez").toHaveLength(1);
    expect(rows[0]!.date.getTime()).toBeLessThan(NEXT_WEEK.getTime());
    const laterRows = await assignments({ taskId: later.taskId });
    expect(laterRows).toHaveLength(1);
    expect(laterRows[0]!.date.getTime()).toBeGreaterThanOrEqual(NEXT_WEEK.getTime());
  });

  it("una ausencia parcial solo bloquea su franja", async () => {
    await loginAs(world.users.admin.email);
    // Lunes de 8:00 a 12:00 al médico.
    unwrap(
      await setAbsence({
        personId: world.people.bea.id,
        date: isoDay(0),
        mode: "block",
        blockStartMinutes: 8 * 60,
        blockEndMinutes: 12 * 60,
        reason: "Médico",
      }),
    );
    const project = await projectWithoutLamps();
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id, personIds: [world.people.bea.id] }));

    await plan();
    const [row] = await assignments({ taskId });
    expect(row!.date.toISOString().slice(0, 10)).toBe(isoDay(0));
    expect([row!.startSlot, row!.endSlot]).toEqual([4, 6]); // 12:00–14:00
  });

  it("no coloca imprevistas en festivos ni a un participante ausente", async () => {
    await loginAs(world.users.admin.email);
    unwrap(await createHoliday({ name: "Fiesta local", startDate: isoDay(0), endDate: isoDay(0) }));
    unwrap(
      await setAbsence({ personId: world.people.ana.id, date: isoDay(1), endDate: isoDay(2), mode: "range", reason: "Vacaciones" }),
    );
    const project = await projectWithoutLamps();
    const { taskId } = unwrap(
      await newAdHoc({ projectId: project.id, personIds: [world.people.ana.id, world.people.bea.id] }),
    );

    await plan();
    const rows = await assignments({ taskId });
    assertPlacedTogether(rows, [world.people.ana.id, world.people.bea.id], 2);
    // Lunes festivo; martes y miércoles Ana de vacaciones → jueves.
    expect(rows[0]!.date.toISOString().slice(0, 10)).toBe(isoDay(3));
  });
});

describe("imprevista nueva con un borrador de esta semana ya generado", () => {
  // «Hoy» es el miércoles de WEEK a las 9:00: la semana en curso es WEEK.
  const WEDNESDAY = dayOf(2);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(WEDNESDAY.getTime() + 9 * 3_600_000));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("se inyecta al momento en el borrador, desde hoy, sin solapar a nadie", async () => {
    const lamp = await createPlannableLamp(world);
    await plan();
    const before = await assignments();

    const res = unwrap(
      await newAdHoc({ projectId: lamp.projectId, personIds: [world.people.ana.id, world.people.bea.id], estimatedHours: 1.5 }),
    );
    expect(res.scheduledInPlanning).toBe(true);

    const rows = await assignments({ taskId: res.taskId });
    assertPlacedTogether(rows, [world.people.ana.id, world.people.bea.id], 1.5);
    expect(rows[0]!.date.getTime()).toBeGreaterThanOrEqual(WEDNESDAY.getTime());
    expect(rows[0]!.planningId).toBe(before[0]!.planningId);

    const all = await assignments();
    expect(all).toHaveLength(before.length + 2);
    assertNoOverlaps(all);
    expect(await pendingIds()).toEqual([]);
  });

  it("si el planning de la semana ya está publicado no lo toca: queda pendiente", async () => {
    const lamp = await createPlannableLamp(world);
    await plan();
    await loginAs(world.users.admin.email);
    unwrap(await publishPlanningAction({ weekStart: WEEK_ISO }));
    const before = await prisma.planningAssignment.count();

    const res = unwrap(await newAdHoc({ projectId: lamp.projectId }));
    expect(res.scheduledInPlanning).toBe(false);
    expect(await prisma.planningAssignment.count()).toBe(before);
    expect(await pendingIds()).toEqual([res.taskId]);
    expect((await prisma.planning.findFirstOrThrow()).status).toBe(PlanningStatus.PUBLISHED);
  });

  it("una imprevista larga creada a mitad de semana se reparte desde hoy en el borrador", async () => {
    const lamp = await createPlannableLamp(world);
    await plan();

    const res = unwrap(await newAdHoc({ projectId: lamp.projectId, estimatedHours: 10 }));
    expect(res.scheduledInPlanning).toBe(true);
    expect(res.unplacedHours).toBe(0);
    const rows = await assignments({ taskId: res.taskId });
    expect(hoursByPerson(rows).get(world.people.ana.id)).toBeCloseTo(10);
    for (const r of rows) expect(r.date.getTime()).toBeGreaterThanOrEqual(WEDNESDAY.getTime());
    chunksOf(rows, [world.people.ana.id]);
    assertNoOverlaps(await assignments());
  });
});

/** Horas colocadas por persona para una tarea. */
function hoursByPerson(rows: PlanningAssignment[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.personId, (m.get(r.personId) ?? 0) + (r.endSlot - r.startSlot));
  return m;
}

/** Cada tramo lo hacen todos los participantes juntos: mismas franjas para todos. */
function chunksOf(rows: PlanningAssignment[], participantIds: string[]) {
  const byChunk = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.date.toISOString().slice(0, 10)} ${r.startSlot}-${r.endSlot}`;
    byChunk.set(key, [...(byChunk.get(key) ?? []), r.personId]);
    expect(r.hours).toBeCloseTo(r.endSlot - r.startSlot);
    expect(r.isOverride).toBe(true);
  }
  for (const [key, people] of byChunk) expect(people.sort(), key).toEqual([...participantIds].sort());
  return [...byChunk.keys()].sort();
}

describe("imprevistas largas, horarios y semanas", () => {
  it("una imprevista de 12 h se reparte en varios días, todos los participantes a la vez", async () => {
    const project = await projectWithoutLamps();
    const both = [world.people.ana.id, world.people.bea.id];
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id, personIds: both, estimatedHours: 12 }));

    const result = await plan();
    expect(result.unscheduledHours).toBe(0);
    const rows = await assignments({ taskId });
    expect(chunksOf(rows, both)).toEqual([`${isoDay(0)} 0-8`, `${isoDay(1)} 0-4`]);
    for (const id of both) expect(hoursByPerson(rows).get(id)).toBeCloseTo(12);
    assertNoOverlaps(await assignments());
  });

  it("si no cabe en la semana coloca lo que quepa, avisa y deja el resto para la siguiente", async () => {
    await loginAs(world.users.admin.email);
    unwrap(
      await setAbsence({ personId: world.people.ana.id, date: isoDay(0), endDate: isoDay(3), mode: "range", reason: "Vacaciones" }),
    );
    const project = await projectWithoutLamps();
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id, estimatedHours: 12 }));

    const week1 = await plan();
    const rows1 = await assignments({ taskId });
    expect(chunksOf(rows1, [world.people.ana.id])).toEqual([`${isoDay(4)} 0-8`]);
    expect(week1.unscheduledHours).toBeCloseTo(4);
    expect(week1.warnings.some((w) => /4\.00h de imprevista sin hueco/.test(w)), week1.warnings.join("\n")).toBe(true);

    await plan(NEXT_WEEK);
    const rows = await assignments({ taskId });
    expect(hoursByPerson(rows).get(world.people.ana.id)).toBeCloseTo(12);
    const nextWeekRows = rows.filter((r) => r.date.getTime() >= NEXT_WEEK.getTime());
    expect(chunksOf(nextWeekRows, [world.people.ana.id])).toEqual([`${NEXT_WEEK.toISOString().slice(0, 10)} 0-4`]);
  });

  it("usa el horario real de cada participante: la franja común es la intersección (jornada reducida)", async () => {
    // Bea solo trabaja de 8:00 a 12:00.
    await loginAs(world.users.admin.email);
    await savePersonWorkWindows({
      personId: world.people.bea.id,
      windows: [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinutes: 8 * 60, endMinutes: 12 * 60 })),
    });
    const project = await projectWithoutLamps();
    const both = [world.people.ana.id, world.people.bea.id];
    const shared = unwrap(await newAdHoc({ projectId: project.id, personIds: both, estimatedHours: 6 }));
    const anaAlone = unwrap(await newAdHoc({ projectId: project.id, estimatedHours: 3 }));

    await plan();
    expect(chunksOf(await assignments({ taskId: shared.taskId }), both)).toEqual([
      `${isoDay(0)} 0-4`,
      `${isoDay(1)} 0-2`,
    ]);
    // Ana sigue libre el lunes por la tarde: su imprevista sola entra ahí.
    expect(chunksOf(await assignments({ taskId: anaAlone.taskId }), [world.people.ana.id])).toEqual([
      `${isoDay(0)} 4-7`,
    ]);
    const beaRows = (await assignments()).filter((r) => r.personId === world.people.bea.id);
    for (const r of beaRows) expect(r.endSlot, "Bea fuera de su horario").toBeLessThanOrEqual(4);
    assertNoOverlaps(await assignments());
  });

  it("con todo ya colocado en una semana anterior, la siguiente avisa de que no hay nada que planificar", async () => {
    const project = await projectWithoutLamps();
    unwrap(await newAdHoc({ projectId: project.id }));
    await plan(WEEK);

    await expect(plan(NEXT_WEEK)).rejects.toThrow(/No hay tareas|ya está cubierto/);
    expect(await prisma.planning.count()).toBe(1);
  });
});

describe("imprevista colocada en una semana ya pasada y no completada", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("vuelve a planificarse en la semana siguiente con las horas que faltan", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(dayOf(2).getTime() + 9 * 3_600_000)); // miércoles de WEEK

    const project = await projectWithoutLamps();
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id, estimatedHours: 3 }));
    await plan(WEEK);
    const first = await assignments({ taskId });
    expect(chunksOf(first, [world.people.ana.id])).toEqual([`${isoDay(0)} 0-3`]);

    // Ana solo llegó a fichar 1 h el lunes y no la completó.
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: project.id,
        lampId: t.lampId,
        taskId,
        process: "IMPREVISTA",
        startedAt: `${isoDay(0)}T08:00:00.000Z`,
        hours: 1,
      }),
    );

    // Pasa una semana: miércoles de NEXT_WEEK.
    vi.setSystemTime(new Date(NEXT_WEEK.getTime() + 2 * DAY_MS + 9 * 3_600_000));
    await plan(NEXT_WEEK);

    const rows = await assignments({ taskId });
    const next = rows.filter((r) => r.date.getTime() >= NEXT_WEEK.getTime());
    expect(hoursByPerson(next).get(world.people.ana.id)).toBeCloseTo(2);
    // El histórico de la semana pasada no se toca.
    expect(rows.filter((r) => r.date.getTime() < NEXT_WEEK.getTime())).toEqual(first);
  });
});

describe("fichar imprevistas: solo sus participantes", () => {
  it("un operario de la misma nave que no participa no puede fichar, cronometrar ni completar; admin sí registra por el participante", async () => {
    const project = await projectWithoutLamps();
    const { taskId } = unwrap(await newAdHoc({ projectId: project.id })); // solo Ana
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    const base = { projectId: t.projectId, lampId: t.lampId, taskId, process: "IMPREVISTA" };

    await loginAs(world.users.bea.email);
    expect(expectFail(await createManualEntry({ ...base, startedAt: `${PAST}T08:00:00.000Z`, hours: 1 }))).toMatch(
      /asignados a esta imprevista/,
    );
    expect(expectFail(await startTimer(base))).toMatch(/asignados a esta imprevista/);
    expect(expectFail(await completeTask({ taskId }))).toMatch(/asignados a esta imprevista/);
    expect(await prisma.timeEntry.count()).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).isCompleted).toBe(false);

    await loginAs(world.users.admin.email);
    unwrap(
      await createManualEntryForTask({
        ...base,
        personId: world.people.ana.id,
        startedAt: `${PAST}T08:00:00.000Z`,
        endedAt: `${PAST}T09:00:00.000Z`,
      }),
    );
    await loginAs(world.users.ana.email);
    unwrap(await completeTask({ taskId }));

    const entries = await prisma.timeEntry.findMany();
    expect(entries.map((e) => [e.userId, e.hours])).toEqual([[world.users.ana.id, 1]]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).isCompleted).toBe(true);
  });
});
