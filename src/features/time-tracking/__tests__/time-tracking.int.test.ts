import { beforeEach, describe, expect, it } from "vitest";
import { WorkOrderStatus } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  completeTask,
  createManualEntriesFromRanges,
  createManualEntry,
  deleteEntry,
  recordAndCompleteGroupedOtTasks,
  startTimer,
  stopTimer,
  uncompleteTask,
  updateEntry,
} from "@/features/time-tracking/actions";
import {
  buildWorld,
  createPlannableLamp,
  expectFail,
  loginAs,
  unwrap,
  type World,
} from "@/test/integration/world";

let world: World;
let lamp: Awaited<ReturnType<typeof createPlannableLamp>>;

// Un martes ya pasado, por la mañana (sin cruzar la comida).
const DAY = "2026-10-20";
const at = (hhmm: string) => `${DAY}T${hhmm}:00.000Z`;

beforeEach(async () => {
  world = await buildWorld();
  lamp = await createPlannableLamp(world); // 1 unidad TELA 2 m²: CNC → ENSAMBLAJE → PINTURA
});

const task = (process: string) => lamp.tasks.find((t) => t.process === process)!;

function logHours(process: string, startedAt: string, hours: number) {
  const t = task(process);
  return createManualEntry({ projectId: lamp.projectId, lampId: lamp.lampId, taskId: t.id, process, startedAt, hours });
}

async function workOrderStatus(process: string) {
  return (await prisma.workOrder.findUniqueOrThrow({ where: { id: lamp.workOrderIdByProcess[process] } })).status;
}

/** Invariante: una OT está cerrada si y solo si todas sus tareas están completadas. */
async function assertWorkOrdersConsistent() {
  const wos = await prisma.workOrder.findMany({ include: { tasks: { select: { isCompleted: true } } } });
  expect(wos.length).toBeGreaterThan(0);
  for (const wo of wos) {
    const allDone = wo.tasks.every((t) => t.isCompleted);
    expect(wo.status, `OT ${wo.number}: cerrada ⇔ todas sus tareas completadas`).toBe(
      allDone ? WorkOrderStatus.CLOSED : WorkOrderStatus.OPEN,
    );
  }
}

describe("cadena de procesos", () => {
  it("no deja fichar un proceso hasta completar el anterior del mismo elemento", async () => {
    await loginAs(world.users.ana.email);

    expect(expectFail(await logHours("ENSAMBLAJE", at("08:00"), 1))).toMatch(/bloqueada/);
    expect(await prisma.timeEntry.count()).toBe(0);

    unwrap(await logHours("CNC", at("08:00"), 2));
    unwrap(await completeTask({ taskId: task("CNC").id }));
    unwrap(await logHours("ENSAMBLAJE", at("10:00"), 1));

    const entries = await prisma.timeEntry.findMany({ orderBy: { startedAt: "asc" } });
    expect(entries.map((e) => [e.process, e.hours, e.userId])).toEqual([
      ["CNC", 2, world.users.ana.id],
      ["ENSAMBLAJE", 1, world.users.ana.id],
    ]);
    expect(entries[0]!.endedAt!.toISOString()).toBe(at("10:00"));
  });

  it("el timer también respeta la cadena y solo admite uno abierto por usuario", async () => {
    await loginAs(world.users.ana.email);
    const base = { projectId: lamp.projectId, lampId: lamp.lampId };

    expect(expectFail(await startTimer({ ...base, taskId: task("PINTURA").id }))).toMatch(/bloqueada/);

    unwrap(await startTimer({ ...base, taskId: task("CNC").id }));
    expect(expectFail(await startTimer({ ...base, taskId: task("CNC").id }))).toMatch(/timer activo/);
    // Con el timer abierto no se puede completar a mano.
    expect(expectFail(await completeTask({ taskId: task("CNC").id }))).toMatch(/timer activo/);

    const open = await prisma.timeEntry.findFirstOrThrow({ where: { endedAt: null } });
    unwrap(await stopTimer({ entryId: open.id }));
    const closed = await prisma.timeEntry.findUniqueOrThrow({ where: { id: open.id } });
    expect(closed.endedAt).not.toBeNull();
    expect(closed.hours).toBeGreaterThanOrEqual(0);
  });
});

describe("solapes y permisos", () => {
  it("rechaza horas que se solapan con otras del mismo usuario, pero no con las de otro", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await logHours("CNC", at("08:00"), 2));

    expect(expectFail(await logHours("CNC", at("09:30"), 1))).toMatch(/Ya tienes horas registradas/);
    expect(await prisma.timeEntry.count()).toBe(1);

    // Pegado justo al final no es solape.
    unwrap(await logHours("CNC", at("10:00"), 0.5));

    await loginAs(world.users.bea.email);
    unwrap(await logHours("CNC", at("08:00"), 2));
    expect(await prisma.timeEntry.count()).toBe(3);
  });

  it("los rangos manuales no pueden solaparse entre sí ni estar en el futuro", async () => {
    await loginAs(world.users.ana.email);
    const t = task("CNC");
    const base = { projectId: lamp.projectId, lampId: lamp.lampId, taskId: t.id, process: "CNC" };

    const overlapping = await createManualEntriesFromRanges({
      ...base,
      ranges: [
        { startedAt: at("08:00"), endedAt: at("10:00") },
        { startedAt: at("09:00"), endedAt: at("11:00") },
      ],
    });
    expectFail(overlapping);

    const future = new Date(Date.now() + 3 * 86_400_000);
    future.setUTCHours(8, 0, 0, 0);
    const futureEnd = new Date(future.getTime() + 3_600_000);
    expectFail(
      await createManualEntriesFromRanges({
        ...base,
        ranges: [{ startedAt: future.toISOString(), endedAt: futureEnd.toISOString() }],
      }),
    );
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it("un operario no puede fichar en tareas de una nave que no es la suya", async () => {
    await loginAs(world.users.carl.email); // Carl es de N2; la lámpara está en N1
    expect(expectFail(await logHours("CNC", at("08:00"), 1))).toMatch(/acceso a tareas de esa nave/);
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it("un operario no puede editar ni borrar registros de otro; el admin sí", async () => {
    await loginAs(world.users.ana.email);
    unwrap(await logHours("CNC", at("08:00"), 2));
    const entry = await prisma.timeEntry.findFirstOrThrow();

    await loginAs(world.users.bea.email);
    expect(expectFail(await deleteEntry({ entryId: entry.id }))).toMatch(/permisos/);
    expect(
      expectFail(await updateEntry({ entryId: entry.id, startedAt: at("08:00"), endedAt: at("09:00") })),
    ).toMatch(/permisos/);

    await loginAs(world.users.admin.email);
    unwrap(await updateEntry({ entryId: entry.id, startedAt: at("08:00"), endedAt: at("09:00") }));
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: entry.id } })).hours).toBeCloseTo(1);
  });
});

describe("OT: se cierra y reabre con sus tareas", () => {
  async function completeAll() {
    await loginAs(world.users.ana.email);
    unwrap(await logHours("CNC", at("08:00"), 2.25));
    unwrap(await completeTask({ taskId: task("CNC").id }));
    expect(await workOrderStatus("CNC")).toBe(WorkOrderStatus.CLOSED);
    expect(await workOrderStatus("ENSAMBLAJE")).toBe(WorkOrderStatus.OPEN);
    unwrap(await logHours("ENSAMBLAJE", at("10:15"), 2));
    unwrap(await completeTask({ taskId: task("ENSAMBLAJE").id }));
    await loginAs(world.users.bea.email);
    unwrap(await logHours("PINTURA", at("12:15"), 0.5));
    unwrap(await completeTask({ taskId: task("PINTURA").id }));
  }

  it("completar la última tarea cierra la OT; descompletar una la reabre", async () => {
    await completeAll();
    const closed = await prisma.workOrder.findUniqueOrThrow({ where: { id: lamp.workOrderIdByProcess.PINTURA } });
    expect(closed.status).toBe(WorkOrderStatus.CLOSED);
    expect(closed.closedAt).not.toBeNull();

    unwrap(await uncompleteTask({ taskId: task("PINTURA").id }));
    const reopened = await prisma.workOrder.findUniqueOrThrow({ where: { id: lamp.workOrderIdByProcess.PINTURA } });
    expect(reopened.status).toBe(WorkOrderStatus.OPEN);
    expect(reopened.closedAt).toBeNull();
    expect(await workOrderStatus("CNC")).toBe(WorkOrderStatus.CLOSED);
    await assertWorkOrdersConsistent();
  });

  it("borrar horas de una tarea completada que queda corta la reabre, y la OT con ella", async () => {
    await completeAll();
    const pintura = await prisma.timeEntry.findFirstOrThrow({ where: { process: "PINTURA" } });

    await loginAs(world.users.bea.email);
    unwrap(await deleteEntry({ entryId: pintura.id }));

    expect((await prisma.task.findUniqueOrThrow({ where: { id: task("PINTURA").id } })).isCompleted).toBe(false);
    await assertWorkOrdersConsistent();
  });

  it("recortar horas de una tarea completada mantiene la OT coherente", async () => {
    await completeAll();
    const cnc = await prisma.timeEntry.findFirstOrThrow({ where: { process: "CNC" } });

    await loginAs(world.users.ana.email);
    unwrap(await updateEntry({ entryId: cnc.id, startedAt: at("08:00"), endedAt: at("08:30") }));

    expect((await prisma.task.findUniqueOrThrow({ where: { id: task("CNC").id } })).isCompleted).toBe(false);
    await assertWorkOrdersConsistent();
  });
});

describe("OT agrupada: registrar y completar varias tareas iguales de una vez", () => {
  it("reparte las horas en proporción a lo estimado, completa las tareas y cierra la OT", async () => {
    // Lámpara con 2 unidades: «agrupar idénticas» mete sus dos CNC (2h cada uno) en la misma OT.
    const twin = await createPlannableLamp(world, { name: "Hotel Gemelas", units: 2 });
    const cncTasks = twin.tasks.filter((t) => t.process === "CNC");
    expect(cncTasks).toHaveLength(2);
    const cncOt = { id: twin.workOrderIdByProcess.CNC! };
    expect(new Set(cncTasks.map((t) => t.workOrderId))).toEqual(new Set([cncOt.id]));

    await loginAs(world.users.ana.email);
    unwrap(
      await recordAndCompleteGroupedOtTasks({
        mode: "manualRanges",
        taskId: cncTasks[0]!.id,
        projectId: twin.projectId,
        lampId: twin.lampId,
        process: "CNC",
        quantity: 2,
        ranges: [{ startedAt: at("08:00"), endedAt: at("12:00") }],
      }),
    );

    const entries = await prisma.timeEntry.findMany({ where: { taskId: { in: cncTasks.map((t) => t.id) } } });
    const byTask = new Map<string, number>();
    for (const e of entries) byTask.set(e.taskId!, (byTask.get(e.taskId!) ?? 0) + (e.hours ?? 0));
    expect([...byTask.values()].map((h) => Number(h.toFixed(4)))).toEqual([2, 2]);
    // Los tramos no se solapan entre sí y cubren exactamente las 4h.
    const sorted = entries.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    expect(sorted[0]!.startedAt.toISOString()).toBe(at("08:00"));
    expect(sorted.at(-1)!.endedAt!.toISOString()).toBe(at("12:00"));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.startedAt.getTime()).toBeGreaterThanOrEqual(sorted[i - 1]!.endedAt!.getTime());
    }

    const tasks = await prisma.task.findMany({ where: { id: { in: cncTasks.map((t) => t.id) } } });
    expect(tasks.every((t) => t.isCompleted)).toBe(true);
    expect((await prisma.workOrder.findUniqueOrThrow({ where: { id: cncOt.id } })).status).toBe(
      WorkOrderStatus.CLOSED,
    );
  });
});
