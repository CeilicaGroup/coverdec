import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElementTypology, ProjectKind, WorkOrderStatus, type PlanningAssignment } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { generatePlanning } from "@/features/planning/service";
import { completeTask, createManualEntry } from "@/features/time-tracking/actions";
import { createLamp, createProject, setLampApprovedForPlanning } from "@/features/projects/actions";
import {
  autoGroupIdenticalTasks,
  createWorkOrder,
  deleteWorkOrder,
  splitWorkOrder,
  updateWorkOrder,
} from "@/features/work-orders/actions";
import { setWorkOrderExecutors } from "@/features/work-orders/set-work-order-executors";
import { loadWorkOrderExecutors } from "@/features/work-orders/queries";
import { savePerson } from "@/features/people/actions";
import { createAdHocTask } from "@/features/ad-hoc/actions";
import { buildWorld, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

const DAY_MS = 86_400_000;
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const YEAR = new Date().getUTCFullYear();
// Martes ya pasado: fichajes reales sin cruzar la comida.
const PAST_DAY = "2026-10-20";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

/** Proyecto + lámpara TELA aprobada, SIN agrupar en OT (para poder agrupar varias a la vez). */
async function approvedLamp(name: string, surfaceM2 = 2) {
  await loginAs(world.users.admin.email);
  const project = unwrap(await createProject({ name, kind: ProjectKind.PRODUCCION, isBillable: true }));
  const lamp = unwrap(
    await createLamp({
      projectId: project.id,
      name: "Lámpara",
      elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2, units: 1 }],
    }),
  );
  unwrap(await setLampApprovedForPlanning({ lampId: lamp.id, isApprovedForPlanning: true }));
  const tasks = await prisma.task.findMany({ where: { lampId: lamp.id }, orderBy: { order: "asc" } });
  const byProcess = (p: string) => tasks.find((t) => t.process === p)!;
  return { projectId: project.id, lampId: lamp.id, tasks, byProcess };
}

/** Dos lámparas idénticas agrupadas en la misma tanda: una OT por proceso con 2 tareas. */
async function twoLampsGrouped() {
  const a = await approvedLamp("Hotel A");
  const b = await approvedLamp("Hotel B");
  await loginAs(world.users.admin.email);
  const result = unwrap(await autoGroupIdenticalTasks());
  const otOf = async (process: string) =>
    prisma.workOrder.findFirstOrThrow({
      where: { tasks: { some: { process } } },
      include: { tasks: { orderBy: { workOrderSequence: "asc" } } },
    });
  return { a, b, result, otOf };
}

async function logAndComplete(userEmail: string, lamp: { projectId: string; lampId: string }, taskId: string, process: string, startHHMM: string, hours: number) {
  await loginAs(userEmail);
  unwrap(
    await createManualEntry({
      projectId: lamp.projectId,
      lampId: lamp.lampId,
      taskId,
      process,
      startedAt: `${PAST_DAY}T${startHHMM}:00.000Z`,
      hours,
    }),
  );
  unwrap(await completeTask({ taskId }));
}

/** Invariante: una OT está cerrada si y solo si todas sus tareas están completadas (y no hay OT vacías). */
async function assertWorkOrdersConsistent() {
  const wos = await prisma.workOrder.findMany({ include: { tasks: { select: { isCompleted: true } } } });
  for (const wo of wos) {
    expect(wo.tasks.length, `OT ${wo.number} vacía`).toBeGreaterThan(0);
    const allDone = wo.tasks.every((t) => t.isCompleted);
    expect(wo.status, `OT ${wo.number}: cerrada ⇔ todas sus tareas completadas`).toBe(
      allDone ? WorkOrderStatus.CLOSED : WorkOrderStatus.OPEN,
    );
  }
}

/** Invariante: la secuencia dentro de cada OT es 0..n-1 sin huecos ni repetidos. */
async function assertSequencesContiguous() {
  const wos = await prisma.workOrder.findMany({ include: { tasks: { select: { workOrderSequence: true } } } });
  for (const wo of wos) {
    const seqs = wo.tasks.map((t) => t.workOrderSequence).sort((x, y) => x! - y!);
    expect(seqs, `secuencia de ${wo.number}`).toEqual(wo.tasks.map((_, i) => i));
  }
}

describe("agrupación automática", () => {
  it("agrupa tareas del mismo tipo de elemento y proceso de distintos proyectos en una OT, numeradas y ordenadas", async () => {
    const { a, b, result, otOf } = await twoLampsGrouped();

    // 3 procesos × 2 lámparas → 3 OT de 2 tareas.
    expect(result).toEqual({ ordersCreated: 3, tasksGrouped: 6 });
    const wos = await prisma.workOrder.findMany({ orderBy: { serial: "asc" } });
    expect(wos.map((w) => w.number)).toEqual([1, 2, 3].map((n) => `OT000${n}-${YEAR}`));
    expect(wos.every((w) => w.status === WorkOrderStatus.OPEN)).toBe(true);

    for (const process of ["CNC", "ENSAMBLAJE", "PINTURA"]) {
      const ot = await otOf(process);
      expect(ot.tasks.map((t) => t.process)).toEqual([process, process]);
      expect(new Set(ot.tasks.map((t) => t.lampId))).toEqual(new Set([a.lampId, b.lampId]));
    }
    await assertSequencesContiguous();
  });

  it("es idempotente: volver a agrupar no crea OT nuevas ni mueve tareas", async () => {
    await twoLampsGrouped();
    const before = await prisma.task.findMany({ select: { id: true, workOrderId: true }, orderBy: { id: "asc" } });

    await loginAs(world.users.admin.email);
    expect(unwrap(await autoGroupIdenticalTasks())).toEqual({ ordersCreated: 0, tasksGrouped: 0 });
    expect(await prisma.workOrder.count()).toBe(3);
    expect(await prisma.task.findMany({ select: { id: true, workOrderId: true }, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("no agrupa tareas ya completadas ni de proyectos inactivos; solo un admin puede agrupar", async () => {
    const a = await approvedLamp("Hotel A");
    await logAndComplete(world.users.ana.email, a, a.byProcess("CNC").id, "CNC", "08:00", 2);
    const inactive = await approvedLamp("Inactivo");
    await prisma.project.update({ where: { id: inactive.projectId }, data: { isActive: false } });

    await loginAs(world.users.jefe.email);
    await expect(autoGroupIdenticalTasks()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.workOrder.count()).toBe(0);

    await loginAs(world.users.admin.email);
    expect(unwrap(await autoGroupIdenticalTasks())).toEqual({ ordersCreated: 2, tasksGrouped: 2 });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("CNC").id } })).workOrderId).toBeNull();
    expect(await prisma.task.count({ where: { lampId: inactive.lampId, workOrderId: { not: null } } })).toBe(0);
  });
});

describe("crear / editar / borrar OT a mano", () => {
  it("crear una OT valida las tareas: ni duplicadas, ni inexistentes, ni de otra OT, ni completadas", async () => {
    const a = await approvedLamp("Hotel A");
    const b = await approvedLamp("Hotel B");
    await logAndComplete(world.users.ana.email, b, b.byProcess("CNC").id, "CNC", "08:00", 2);
    await loginAs(world.users.admin.email);

    const cncA = a.byProcess("CNC").id;
    expect(expectFail(await createWorkOrder({ taskIds: [] }))).toMatch(/al menos 1 tarea/);
    expect(expectFail(await createWorkOrder({ taskIds: [cncA, cncA] }))).toMatch(/duplicadas/);
    expect(expectFail(await createWorkOrder({ taskIds: [cncA, "no-existe"] }))).toMatch(/no existe/);
    expect(expectFail(await createWorkOrder({ taskIds: [b.byProcess("CNC").id] }))).toMatch(/completadas/);
    expect(await prisma.workOrder.count()).toBe(0);

    const created = unwrap(await createWorkOrder({ taskIds: [a.byProcess("PINTURA").id, cncA], notes: "Urgente" }));
    expect(created.number).toBe(`OT0001-${YEAR}`);
    // El orden de la OT sigue la cadena de procesos de la lámpara, no el orden de selección.
    const tasks = await prisma.task.findMany({ where: { workOrderId: created.id }, orderBy: { workOrderSequence: "asc" } });
    expect(tasks.map((t) => t.process)).toEqual(["CNC", "PINTURA"]);

    expect(expectFail(await createWorkOrder({ taskIds: [cncA] }))).toMatch(/otra OT/);
    expect(await prisma.workOrder.count()).toBe(1);

    await loginAs(world.users.jefe.email);
    await expect(createWorkOrder({ taskIds: [a.byProcess("ENSAMBLAJE").id] })).rejects.toThrow(/NEXT_REDIRECT/);
  });

  it("editar la lista de tareas libera las quitadas y una OT cerrada no se puede editar", async () => {
    const { a, b, otOf } = await twoLampsGrouped();
    const cnc = await otOf("CNC");
    await loginAs(world.users.admin.email);

    unwrap(await updateWorkOrder({ id: cnc.id, taskIds: [a.byProcess("CNC").id], notes: "solo A" }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.byProcess("CNC").id } }))).toMatchObject({
      workOrderId: null,
      workOrderSequence: null,
    });
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: cnc.id } })).notes).toBe("solo A");
    await assertSequencesContiguous();

    // La tarea liberada se puede meter en otra OT.
    unwrap(await createWorkOrder({ taskIds: [b.byProcess("CNC").id] }));

    // Al completar su única tarea la OT se cierra y deja de ser editable.
    await logAndComplete(world.users.ana.email, a, a.byProcess("CNC").id, "CNC", "08:00", 2);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: cnc.id } })).status).toBe(WorkOrderStatus.CLOSED);
    await loginAs(world.users.admin.email);
    expect(expectFail(await updateWorkOrder({ id: cnc.id, notes: "otra" }))).toMatch(/abiertas/);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: cnc.id } })).notes).toBe("solo A");
  });

  it("una OT con alguna tarea ya completada se puede seguir editando (notas, orden, ejecutores)", async () => {
    const { a, b, otOf } = await twoLampsGrouped();
    await logAndComplete(world.users.ana.email, a, a.byProcess("CNC").id, "CNC", "08:00", 2);
    const cnc = await otOf("CNC");
    expect(cnc.status).toBe(WorkOrderStatus.OPEN);

    // La pantalla de OT reenvía siempre todas las tareas de la OT al guardar.
    await loginAs(world.users.admin.email);
    unwrap(await updateWorkOrder({ id: cnc.id, taskIds: cnc.tasks.map((t) => t.id), notes: "revisada" }));

    const after = await prisma.workOrder.findUniqueOrThrow({ where: { id: cnc.id }, include: { tasks: true } });
    expect(after.notes).toBe("revisada");
    expect(new Set(after.tasks.map((t) => t.id))).toEqual(new Set([a.byProcess("CNC").id, b.byProcess("CNC").id]));
    await assertWorkOrdersConsistent();
  });

  it("las imprevistas no van en OT: ni al crearla ni al editarla", async () => {
    const { a, otOf } = await twoLampsGrouped();
    await loginAs(world.users.jefe.email);
    const { taskId: adHocId } = unwrap(
      await createAdHocTask({
        projectId: a.projectId,
        personIds: [world.people.ana.id],
        estimatedHours: 2,
        notes: "Reparar soporte",
        internalNotes: "Golpe en transporte",
      }),
    );
    const cnc = await otOf("CNC");

    await loginAs(world.users.admin.email);
    expect(expectFail(await createWorkOrder({ taskIds: [adHocId] }))).toMatch(/imprevistas y de transporte no van en OT/);
    expect(
      expectFail(await updateWorkOrder({ id: cnc.id, taskIds: [...cnc.tasks.map((t) => t.id), adHocId] })),
    ).toMatch(/imprevistas y de transporte/);

    expect(await prisma.workOrder.count()).toBe(3);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: adHocId } })).workOrderId).toBeNull();
    expect(await prisma.task.count({ where: { workOrderId: cnc.id } })).toBe(2);
    // Agrupar automáticamente tampoco la mete en ninguna OT.
    expect(unwrap(await autoGroupIdenticalTasks()).ordersCreated).toBe(0);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: adHocId } })).workOrderId).toBeNull();
  });

  it("dividir mueve las tareas elegidas a una OT nueva y el origen conserva al menos una", async () => {
    const { a, b, otOf } = await twoLampsGrouped();
    const ens = await otOf("ENSAMBLAJE");
    await loginAs(world.users.admin.email);

    expect(expectFail(await splitWorkOrder({ id: ens.id, taskIds: ens.tasks.map((t) => t.id) }))).toMatch(/al menos una tarea/);
    expect(expectFail(await splitWorkOrder({ id: ens.id, taskIds: [a.byProcess("CNC").id] }))).toMatch(/no pertenece/);
    expect(await prisma.workOrder.count()).toBe(3);

    const created = unwrap(await splitWorkOrder({ id: ens.id, taskIds: [b.byProcess("ENSAMBLAJE").id], notes: "B aparte" }));
    expect(created.number).toBe(`OT0004-${YEAR}`);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.byProcess("ENSAMBLAJE").id } })).workOrderId).toBe(created.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("ENSAMBLAJE").id } })).workOrderId).toBe(ens.id);
    await assertSequencesContiguous();

    // Con una sola tarea ya no se puede dividir más.
    expect(expectFail(await splitWorkOrder({ id: ens.id, taskIds: [a.byProcess("ENSAMBLAJE").id] }))).toMatch(/al menos 2 tareas/);
  });

  it("dividir una OT con una tarea completada deja cerrada la parte que queda toda completada", async () => {
    const { a, b, otOf } = await twoLampsGrouped();
    await logAndComplete(world.users.ana.email, a, a.byProcess("CNC").id, "CNC", "08:00", 2);
    const cnc = await otOf("CNC");

    await loginAs(world.users.admin.email);
    const created = unwrap(await splitWorkOrder({ id: cnc.id, taskIds: [b.byProcess("CNC").id] }));

    expect((await prisma.task.findUniqueOrThrow({ where: { id: b.byProcess("CNC").id } })).workOrderId).toBe(created.id);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("CNC").id } })).workOrderId).toBe(cnc.id);
    await assertWorkOrdersConsistent();
  });

  it("borrar una OT libera sus tareas, pero no si ya tienen horas fichadas", async () => {
    const { a, otOf } = await twoLampsGrouped();
    const pintura = await otOf("PINTURA");
    const cnc = await otOf("CNC");
    await loginAs(world.users.admin.email);

    unwrap(await deleteWorkOrder({ id: pintura.id }));
    expect(await prisma.workOrder.findUnique({ where: { id: pintura.id } })).toBeNull();
    expect(await prisma.task.count({ where: { process: "PINTURA", workOrderId: null } })).toBe(2);

    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: a.projectId,
        lampId: a.lampId,
        taskId: a.byProcess("CNC").id,
        process: "CNC",
        startedAt: `${PAST_DAY}T08:00:00.000Z`,
        hours: 1,
      }),
    );
    await loginAs(world.users.admin.email);
    expect(expectFail(await deleteWorkOrder({ id: cnc.id }))).toMatch(/registros de tiempo/);
    expect(await prisma.task.count({ where: { workOrderId: cnc.id } })).toBe(2);
  });
});

describe("elegir ejecutores de una OT planificada", () => {
  async function planWeek() {
    return generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });
  }

  const rowsOf = (taskIds: string[]) =>
    prisma.planningAssignment.findMany({ where: { taskId: { in: taskIds } }, orderBy: [{ date: "asc" }, { startSlot: "asc" }] });

  function assertNoPersonOverlap(rows: PlanningAssignment[]) {
    for (const [i, x] of rows.entries()) {
      for (const y of rows.slice(i + 1)) {
        if (x.personId !== y.personId || x.date.getTime() !== y.date.getTime()) continue;
        const overlap = x.startSlot < y.endSlot && y.startSlot < x.endSlot;
        expect(overlap, `persona ${x.personId} en dos tareas a la vez el ${x.date.toISOString().slice(0, 10)}`).toBe(false);
      }
    }
  }

  it("exige OT planificada, personas activas, de la nave de la OT y con la especialidad del proceso", async () => {
    const { otOf } = await twoLampsGrouped();
    const cnc = await otOf("CNC");
    await loginAs(world.users.jefe.email);

    expect(expectFail(await setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id] }))).toMatch(/ningún planning/);

    await planWeek();
    await loginAs(world.users.jefe.email);
    expect(expectFail(await setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id, world.people.carl.id] }))).toMatch(/nave de la OT/);
    // Bea no sabe hacer CNC (ni como responsable ni de apoyo).
    expect(expectFail(await setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id, world.people.bea.id] }))).toMatch(/BEA no tiene la especialidad CNC/);
    await prisma.person.update({ where: { id: world.people.bea.id }, data: { isActive: false } });
    expect(expectFail(await setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id, world.people.bea.id] }))).toMatch(/inactiva/);
    expectFail(await setWorkOrderExecutors({
        workOrderId: cnc.id,
        personIds: [world.people.ana.id, world.people.bea.id, world.people.carl.id],
      }));

    // Nada de lo anterior ha tocado el planning: CNC sigue solo en Ana.
    const rows = await rowsOf(cnc.tasks.map((t) => t.id));
    expect(new Set(rows.map((r) => r.personId))).toEqual(new Set([world.people.ana.id]));

    await loginAs(world.users.ana.email);
    await expect(setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id] })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
  }, 120_000);

  /** El jefe le añade a Bea CNC como especialidad de apoyo (después de planificar, como en la vida real). */
  async function giveBeaCncSupport() {
    await loginAs(world.users.jefe.email);
    unwrap(
      await savePerson({
        id: world.people.bea.id,
        iniciales: "BEA",
        color: "#000000",
        hourlyRate: 14.75,
        overtimeHourlyRate: 22.13,
        isActive: true,
        naveIds: [world.naves.n1.id],
        userId: world.users.bea.id,
        specialties: [
          { process: "PINTURA", mode: "responsable" },
          { process: "ENSAMBLAJE", mode: "apoyo" },
          { process: "CNC", mode: "apoyo" },
        ],
      }),
    );
  }

  /** ¿Alguna franja de `extra` choca con las que `personId` ya tiene en el planning? */
  function clashes(all: PlanningAssignment[], personId: string, extra: PlanningAssignment[], ignoreTaskIds: string[] = []) {
    const own = all.filter((r) => r.personId === personId && !ignoreTaskIds.includes(r.taskId));
    return extra.some((x) =>
      own.some((o) => o.date.getTime() === x.date.getTime() && x.startSlot < o.endSlot && o.startSlot < x.endSlot),
    );
  }

  it("añadir un segundo operario duplica las franjas (no las reparte) y las marca como manuales", async () => {
    // Una sola lámpara: mientras Ana hace el CNC, Bea aún no tiene nada (la cadena lo impide).
    const a = await approvedLamp("Hotel A");
    await loginAs(world.users.admin.email);
    unwrap(await autoGroupIdenticalTasks());
    const cncTask = await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("CNC").id } });
    await planWeek();
    const before = await rowsOf([cncTask.id]);
    expect(new Set(before.map((r) => r.personId))).toEqual(new Set([world.people.ana.id]));
    expect(clashes(await prisma.planningAssignment.findMany(), world.people.bea.id, before)).toBe(false);
    await giveBeaCncSupport();

    await loginAs(world.users.admin.email);
    unwrap(await setWorkOrderExecutors({ workOrderId: cncTask.workOrderId!, personIds: [world.people.ana.id, world.people.bea.id] }));

    const after = await rowsOf([cncTask.id]);
    const slots = (rows: PlanningAssignment[], personId: string) =>
      rows
        .filter((r) => r.personId === personId)
        .map((r) => `${r.date.toISOString()}|${r.startSlot}-${r.endSlot}|${r.hours}`)
        .sort();
    expect(slots(after, world.people.ana.id)).toEqual(slots(before, world.people.ana.id));
    expect(slots(after, world.people.bea.id)).toEqual(slots(before, world.people.ana.id));
    expect(after.every((r) => r.isOverride)).toBe(true);
    assertNoPersonOverlap(await prisma.planningAssignment.findMany());
  }, 120_000);

  it("con la tarea ya fichada: sin planning devuelve el motivo (no lanza) y planificada se le añade operario", async () => {
    const a = await approvedLamp("Hotel A");
    await loginAs(world.users.admin.email);
    unwrap(await autoGroupIdenticalTasks());
    const cncTask = await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("CNC").id } });
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: a.projectId,
        lampId: a.lampId,
        taskId: cncTask.id,
        process: "CNC",
        startedAt: `${PAST_DAY}T07:00:00.000Z`,
        hours: 1,
      }),
    );
    await giveBeaCncSupport();

    // Antes Next tapaba el motivo con «No se pudo refrescar la pantalla…».
    await loginAs(world.users.admin.email);
    const unplanned = await setWorkOrderExecutors({ workOrderId: cncTask.workOrderId!, personIds: [world.people.bea.id] });
    expect(expectFail(unplanned)).toMatch(/ningún planning/);
    expect(await rowsOf([cncTask.id])).toHaveLength(0);

    await planWeek();
    await loginAs(world.users.admin.email);
    unwrap(await setWorkOrderExecutors({ workOrderId: cncTask.workOrderId!, personIds: [world.people.ana.id, world.people.bea.id] }));
    const after = await rowsOf([cncTask.id]);
    expect(new Set(after.map((r) => r.personId))).toEqual(new Set([world.people.ana.id, world.people.bea.id]));
    expect(await prisma.timeEntry.count({ where: { taskId: cncTask.id } })).toBe(1);
    assertNoPersonOverlap(await prisma.planningAssignment.findMany());
  }, 120_000);

  it("con la tarea a medias, cambiar el ejecutor solo toca de hoy en adelante: lo pasado queda como historia", async () => {
    // 16 m² → 16 h de ensamblaje: más de un día.
    const a = await approvedLamp("Hotel A", 16);
    await loginAs(world.users.admin.email);
    unwrap(await autoGroupIdenticalTasks());
    const ens = await prisma.task.findUniqueOrThrow({ where: { id: a.byProcess("ENSAMBLAJE").id } });
    await planWeek();
    const before = await rowsOf([ens.id]);
    const days = [...new Set(before.map((r) => r.date.getTime()))].sort((x, y) => x - y);
    expect(days.length, "el ensamblaje debe repartirse en varios días").toBeGreaterThan(1);
    const current = before[0]!.personId;
    const other = current === world.people.ana.id ? world.people.bea.id : world.people.ana.id;
    const lastDay = days.at(-1)!;

    // «Hoy» es el último día del ensamblaje: los anteriores ya pasaron.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(lastDay + 6 * 3_600_000));
      await loginAs(world.users.admin.email);
      unwrap(await setWorkOrderExecutors({ workOrderId: ens.workOrderId!, personIds: [other] }));
      // El diálogo muestra solo al ejecutor actual, no al de días pasados.
      const shown = await loadWorkOrderExecutors([ens.workOrderId!]);
      expect(shown.executorIds.get(ens.workOrderId!)).toEqual([other]);
      expect(shown.readyIds.has(ens.workOrderId!)).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    const after = await rowsOf([ens.id]);
    const past = (rows: PlanningAssignment[]) => rows.filter((r) => r.date.getTime() < lastDay);
    const fromToday = (rows: PlanningAssignment[]) => rows.filter((r) => r.date.getTime() >= lastDay);
    // Lo pasado sigue igual (mismas filas, misma persona) y el nuevo no recibe días pasados.
    expect(past(after).map((r) => [r.id, r.personId])).toEqual(past(before).map((r) => [r.id, r.personId]));
    expect(past(after).every((r) => r.isOverride)).toBe(true);
    // De hoy en adelante, mismas franjas pero del nuevo ejecutor.
    const slots = (rows: PlanningAssignment[]) => rows.map((r) => `${r.date.toISOString()}|${r.startSlot}-${r.endSlot}`).sort();
    expect(fromToday(after).every((r) => r.personId === other)).toBe(true);
    expect(slots(fromToday(after))).toEqual(slots(fromToday(before)));
    assertNoPersonOverlap(await prisma.planningAssignment.findMany());

    // Si «hoy» es después de todo su planning, se pide regenerar en vez de copiar días pasados.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(lastDay + 30 * 3_600_000));
      await loginAs(world.users.admin.email);
      const late = await setWorkOrderExecutors({ workOrderId: ens.workOrderId!, personIds: [current] });
      expect(expectFail(late)).toMatch(/no tiene planning de hoy en adelante/);
    } finally {
      vi.useRealTimers();
    }
    expect(await rowsOf([ens.id])).toEqual(after);
  }, 120_000);

  it("si el segundo ejecutor ya está ocupado a esas horas, se rechaza y el planning no cambia", async () => {
    const { otOf } = await twoLampsGrouped();
    const cnc = await otOf("CNC");
    await planWeek();
    const all = await prisma.planningAssignment.findMany({ orderBy: { id: "asc" } });
    assertNoPersonOverlap(all);
    const cncRows = all.filter((r) => cnc.tasks.some((t) => t.id === r.taskId));
    const beaBusy = clashes(all, world.people.bea.id, cncRows);
    await giveBeaCncSupport();

    await loginAs(world.users.admin.email);
    const attempt = await setWorkOrderExecutors({ workOrderId: cnc.id, personIds: [world.people.ana.id, world.people.bea.id] });
    if (beaBusy) {
      expect(expectFail(attempt)).toMatch(/BEA ya tiene otra tarea planificada/);
      expect(await prisma.planningAssignment.findMany({ orderBy: { id: "asc" } })).toEqual(all);
    } else {
      unwrap(attempt);
    }
    assertNoPersonOverlap(await prisma.planningAssignment.findMany());
  }, 120_000);

  it("cambiar el ejecutor sustituye sus franjas (o se rechaza si choca), sin dobles reservas", async () => {
    const { otOf } = await twoLampsGrouped();
    const ens = await otOf("ENSAMBLAJE");
    await planWeek();
    const taskIds = ens.tasks.map((t) => t.id);
    const all = await prisma.planningAssignment.findMany({ orderBy: { id: "asc" } });
    const before = all.filter((r) => taskIds.includes(r.taskId));
    const plannedHours = before.reduce((s, r) => s + r.hours, 0);
    const current = [...new Set(before.map((r) => r.personId))];
    expect(current).toHaveLength(1);
    const other = current[0] === world.people.ana.id ? world.people.bea.id : world.people.ana.id;
    const otherBusy = clashes(all, other, before, taskIds);

    await loginAs(world.users.admin.email);
    const attempt = await setWorkOrderExecutors({ workOrderId: ens.id, personIds: [other] });
    if (otherBusy) {
      expect(expectFail(attempt)).toMatch(/ya tiene otra tarea planificada/);
      expect(await prisma.planningAssignment.findMany({ orderBy: { id: "asc" } })).toEqual(all);
    } else {
      unwrap(attempt);
      const after = await rowsOf(taskIds);
      expect(new Set(after.map((r) => r.personId))).toEqual(new Set([other]));
      expect(after.reduce((s, r) => s + r.hours, 0)).toBeCloseTo(plannedHours);
    }
    assertNoPersonOverlap(await prisma.planningAssignment.findMany());
  }, 120_000);
});
