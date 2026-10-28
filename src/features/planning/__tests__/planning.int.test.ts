import { beforeEach, describe, expect, it } from "vitest";
import { ElementTypology, PlanningStatus, ProjectKind, type PlanningAssignment } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { generatePlanning, undoPlanning } from "@/features/planning/service";
import { publishPlanningAction, undoPlanningAction } from "@/features/planning/actions";
import { createManualEntry } from "@/features/time-tracking/actions";
import { createLamp, createProject, setLampApprovedForPlanning } from "@/features/projects/actions";
import { setAbsence } from "@/features/people/actions";
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
// Semana que viene + 1: siempre futura, sin registros de horas dentro.
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const WEEK_ISO = WEEK.toISOString().slice(0, 10);
const WEEK_END = new Date(WEEK.getTime() + 5 * DAY_MS);

let world: World;
let lamp: Awaited<ReturnType<typeof createPlannableLamp>>;

beforeEach(async () => {
  world = await buildWorld();
  lamp = await createPlannableLamp(world); // TELA 2 m²: CNC 2h → ENSAMBLAJE 2h → PINTURA 0.8h
});

const plan = () => generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });

async function assignments(): Promise<PlanningAssignment[]> {
  return prisma.planningAssignment.findMany({ orderBy: [{ date: "asc" }, { startSlot: "asc" }] });
}

function hoursByTask(rows: PlanningAssignment[]) {
  const m = new Map<string, number>();
  for (const a of rows) m.set(a.taskId, (m.get(a.taskId) ?? 0) + a.hours);
  return m;
}

/** Instante comparable: día + slot. */
const startKey = (a: PlanningAssignment) => [a.date.getTime(), a.startSlot] as const;
const endKey = (a: PlanningAssignment) => [a.date.getTime(), a.endSlot] as const;
const lte = (x: readonly [number, number], y: readonly [number, number]) =>
  x[0] < y[0] || (x[0] === y[0] && x[1] <= y[1]);

describe("generar planning con el solver real", () => {
  it("planifica todas las horas pendientes respetando especialidades, nave, semana, solapes y cadena", async () => {
    const result = await plan();
    const rows = await assignments();

    expect(result.unscheduledHours).toBe(0);
    expect(result.assignmentsCount).toBe(rows.length);

    // Cada tarea recibe lo estimado (redondeado al cuarto de hora superior).
    const byTask = hoursByTask(rows);
    for (const t of lamp.tasks) {
      const planned = byTask.get(t.id) ?? 0;
      expect(planned, t.process).toBeGreaterThanOrEqual(t.estimatedHours - 1e-6);
      expect(planned, t.process).toBeLessThan(t.estimatedHours + 0.25);
    }

    const people = await prisma.person.findMany({ include: { specialties: true, personNaves: true } });
    const byId = new Map(people.map((p) => [p.id, p]));
    for (const a of rows) {
      const p = byId.get(a.personId)!;
      expect(p.specialties.map((s) => s.process), `${p.iniciales} sin ${a.process}`).toContain(a.process);
      expect(p.personNaves.map((n) => n.naveId)).toContain(world.naves.n1.id);
      expect(a.date.getTime()).toBeGreaterThanOrEqual(WEEK.getTime());
      expect(a.date.getTime()).toBeLessThan(WEEK_END.getTime());
      expect(a.endSlot).toBeGreaterThan(a.startSlot);
    }

    // Una persona no está en dos sitios a la vez.
    for (const [i, a] of rows.entries()) {
      for (const b of rows.slice(i + 1)) {
        if (a.personId !== b.personId || a.date.getTime() !== b.date.getTime()) continue;
        const overlap = a.startSlot < b.endSlot && b.startSlot < a.endSlot;
        expect(overlap, `solape de ${byId.get(a.personId)!.iniciales}`).toBe(false);
      }
    }

    // Precedencia: un proceso no empieza antes de que acabe el anterior del mismo elemento.
    const chain = ["CNC", "ENSAMBLAJE", "PINTURA"].map((p) => lamp.tasks.find((t) => t.process === p)!.id);
    for (let k = 1; k < chain.length; k++) {
      const prev = rows.filter((a) => a.taskId === chain[k - 1]);
      const next = rows.filter((a) => a.taskId === chain[k]);
      const prevEnd = prev.map(endKey).reduce((m, x) => (lte(m, x) ? x : m));
      const nextStart = next.map(startKey).reduce((m, x) => (lte(x, m) ? x : m));
      expect(lte(prevEnd, nextStart), `${k}: empieza antes de acabar el anterior`).toBe(true);
    }
  });

  it("descuenta las horas ya fichadas: solo planifica lo que falta", async () => {
    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: lamp.projectId,
        lampId: lamp.lampId,
        taskId: cnc.id,
        process: "CNC",
        startedAt: "2026-10-20T08:00:00.000Z",
        hours: 1.5,
      }),
    );

    await plan();
    expect(hoursByTask(await assignments()).get(cnc.id)).toBeCloseTo(0.5);
  });

  it("no vuelve a planificar en una semana lo que ya cubre el borrador de la anterior", async () => {
    await plan();
    const nextWeek = new Date(WEEK.getTime() + 7 * DAY_MS);
    await expect(
      generatePlanning({ naveId: world.naves.n1.id, weekStart: nextWeek, planFrom: "WEEK_START" }),
    ).rejects.toThrow(/ya está cubierto/);
  });

  it("regenerar la misma semana sustituye las asignaciones en vez de duplicarlas", async () => {
    const first = await plan();
    const before = hoursByTask(await assignments());
    const second = await plan();

    expect(second.planningId).toBe(first.planningId);
    expect(await prisma.planning.count()).toBe(1);
    expect(hoursByTask(await assignments())).toEqual(before);
  });

  async function absent(personId: string, fromDay: number, toDay: number) {
    await loginAs(world.users.admin.email);
    const iso = (d: number) => new Date(WEEK.getTime() + d * DAY_MS).toISOString().slice(0, 10);
    unwrap(await setAbsence({ personId, date: iso(fromDay), endDate: iso(toDay), mode: "range", reason: "Vacaciones" }));
  }

  it("si el único operario con CNC está de vacaciones toda la semana, no asigna CNC a nadie", async () => {
    await absent(world.people.ana.id, 0, 4);

    // O falla con un mensaje claro, o deja la cadena sin planificar: nunca a alguien sin la especialidad.
    const outcome = await plan().catch((e: Error) => e);
    const rows = await assignments();
    expect(rows.filter((a) => a.process === "CNC")).toEqual([]);
    expect(rows.filter((a) => a.personId === world.people.ana.id)).toEqual([]);
    if (!(outcome instanceof Error)) expect(outcome.unscheduledHours).toBeGreaterThan(0);
  });

  it("no planifica a nadie en festivos", async () => {
    await loginAs(world.users.admin.email);
    unwrap(await createHoliday({ name: "Fiesta local", startDate: WEEK_ISO, endDate: WEEK_ISO }));
    await plan();
    const rows = await assignments();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((a) => a.date.getTime() === WEEK.getTime())).toEqual([]);
  });

  it("no planifica a una persona los días que está ausente", async () => {
    await absent(world.people.ana.id, 0, 1); // lunes y martes
    await plan();
    const rows = await assignments();
    expect(rows.length).toBeGreaterThan(0);
    const tuesday = WEEK.getTime() + DAY_MS;
    expect(rows.filter((a) => a.personId === world.people.ana.id && a.date.getTime() <= tuesday)).toEqual([]);
  });
});

describe("requisitos para planificar", () => {
  /** Oficina da de alta otra lámpara y aún no la agrupa en OT. */
  async function newLampWithoutWorkOrder(approve: boolean) {
    await loginAs(world.users.admin.email);
    const project = await createProject({ name: "Otro", kind: ProjectKind.PRODUCCION, isBillable: true });
    const l = await createLamp({
      projectId: project.id,
      name: "B",
      elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2: 1, units: 1 }],
    });
    if (approve) await setLampApprovedForPlanning({ lampId: l.id, isApprovedForPlanning: true });
    return l;
  }

  it("rechaza planificar si hay tareas aprobadas fuera de una OT abierta, y dice cuáles", async () => {
    await newLampWithoutWorkOrder(true);
    await expect(plan()).rejects.toThrow(/sin OT abierta[\s\S]*Otro · B · CNC/);
    expect(await prisma.planning.count()).toBe(0);
  });

  it("una lámpara nueva sin aprobar (y sin OT) no bloquea el planning del resto", async () => {
    const b = await newLampWithoutWorkOrder(false);
    const result = await plan();
    expect(result.assignmentsCount).toBeGreaterThan(0);
    const bTasks = await prisma.task.findMany({ where: { lampId: b.id }, select: { id: true } });
    expect(await prisma.planningAssignment.count({ where: { taskId: { in: bTasks.map((t) => t.id) } } })).toBe(0);
  });

  it("si nada está aprobado, el error explica que faltan aprobaciones", async () => {
    await loginAs(world.users.admin.email);
    await setLampApprovedForPlanning({ lampId: lamp.lampId, isApprovedForPlanning: false });
    await expect(plan()).rejects.toThrow(/pendiente de aprobación/);
    expect(await prisma.planning.count()).toBe(0);
  });
});

describe("publicar y deshacer", () => {
  it("publicar pasa los borradores a publicado; solo un admin puede", async () => {
    const { planningId } = await plan();

    await loginAs(world.users.jefe.email);
    await expect(publishPlanningAction({ weekStart: WEEK_ISO })).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.planning.findUniqueOrThrow({ where: { id: planningId } })).status).toBe(PlanningStatus.DRAFT);

    await loginAs(world.users.admin.email);
    expect(unwrap(await publishPlanningAction({ weekStart: WEEK_ISO })).publishedCount).toBe(1);
    const published = await prisma.planning.findUniqueOrThrow({ where: { id: planningId } });
    expect(published.status).toBe(PlanningStatus.PUBLISHED);
    expect(published.publishedAt).not.toBeNull();
  });

  it("deshacer borra el planning y sus asignaciones", async () => {
    await plan();
    await loginAs(world.users.admin.email);
    expect(unwrap(await undoPlanningAction({ weekStart: WEEK_ISO })).deletedCount).toBe(1);
    expect(await prisma.planning.count()).toBe(0);
    expect(await prisma.planningAssignment.count()).toBe(0);
  });

  it("no deja deshacer si ya hay horas fichadas en esa semana", async () => {
    await plan();
    const a = (await assignments())[0]!;
    // Fichaje dentro de la semana planificada (montado directo: la UI no deja fichar en el futuro).
    await prisma.timeEntry.create({
      data: {
        userId: world.users.ana.id,
        projectId: lamp.projectId,
        taskId: a.taskId,
        startedAt: new Date(WEEK.getTime() + 8 * 3_600_000),
        endedAt: new Date(WEEK.getTime() + 9 * 3_600_000),
        hours: 1,
      },
    });

    await loginAs(world.users.admin.email);
    expect(expectFail(await undoPlanningAction({ weekStart: WEEK_ISO }))).toMatch(/registros de horas/);
    expect(await prisma.planning.count()).toBe(1);
  });

  it("una lámpara que no cabe en una semana sigue la siguiente; deshacer la primera exige deshacer también la posterior", async () => {
    // 60 m²: solo el CNC ya son 31h de Ana, y luego 60h de ensamblaje.
    await createPlannableLamp(world, { name: "Grande", surfaceM2: 60 });
    const week1 = await plan();
    expect(week1.unscheduledHours).toBeGreaterThan(0);
    const nextWeek = new Date(WEEK.getTime() + 7 * DAY_MS);
    const week2 = await generatePlanning({ naveId: world.naves.n1.id, weekStart: nextWeek, planFrom: "WEEK_START" });
    expect(week2.assignmentsCount).toBeGreaterThan(0);

    // Entre las dos semanas no se planifica ninguna tarea por encima de lo estimado.
    const tasks = await prisma.task.findMany();
    const planned = hoursByTask(await assignments());
    for (const t of tasks) expect(planned.get(t.id) ?? 0).toBeLessThan(t.estimatedHours + 0.25);

    await expect(undoPlanning({ naveId: world.naves.n1.id, weekStart: WEEK })).rejects.toThrow(/semanas posteriores/);
    expect(await prisma.planning.count()).toBe(2);

    const { deletedCount } = await undoPlanning({ naveId: world.naves.n1.id, weekStart: WEEK, includeFutureWeeks: true });
    expect(deletedCount).toBe(2);
    expect(await prisma.planningAssignment.count()).toBe(0);
  }, 300_000);
});
