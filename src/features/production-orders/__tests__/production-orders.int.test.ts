import { beforeEach, describe, expect, it } from "vitest";
import { AuditOutcome, ElementTypology, ProjectKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { createLamp, createProject, toggleProjectActive } from "@/features/projects/actions";
import { createWorkOrder } from "@/features/work-orders/actions";
import { createProductionOrder } from "@/features/production-orders/actions";
import { buildWorld, expectFail, loginAs, resetSession, unwrap, type World } from "@/test/integration/world";

const YEAR = new Date().getUTCFullYear();

let world: World;
let projectId: string;

beforeEach(async () => {
  world = await buildWorld();
  await loginAs(world.users.jefe.email);
  projectId = unwrap(await createProject({ name: "Hotel Test", kind: ProjectKind.PRODUCCION, isBillable: true })).id;
});

/** La auditoría se escribe sin await (fire-and-forget): se espera a que aparezca. */
async function waitForAudit(action: string, outcome: AuditOutcome, entityId?: string) {
  for (let i = 0; i < 50; i++) {
    const row = await prisma.auditLog.findFirst({ where: { action, outcome, entityId } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`sin auditoría ${action} ${outcome}`);
}

describe("órdenes de producción", () => {
  it("crea la OP con número correlativo del año y guarda todos los datos", async () => {
    const first = unwrap(
      await createProductionOrder({
        projectId,
        lampLabel: "Lámpara Hall",
        process: "PINTURA",
        hours: 3.5,
        scheduledAt: "2026-11-02",
        notes: "Color RAL 9010",
      }),
    );
    const second = unwrap(await createProductionOrder({ projectId }));

    expect(first.number).toBe(`OP0001-${YEAR}`);
    expect(second.number).toBe(`OP0002-${YEAR}`);

    const row = await prisma.productionOrder.findUniqueOrThrow({ where: { id: first.id } });
    expect(row).toMatchObject({
      year: YEAR,
      serial: 1,
      projectId,
      lampLabel: "Lámpara Hall",
      process: "PINTURA",
      hours: 3.5,
      notes: "Color RAL 9010",
    });
    expect(row.scheduledAt?.toISOString().slice(0, 10)).toBe("2026-11-02");
    const bare = await prisma.productionOrder.findUniqueOrThrow({ where: { id: second.id } });
    expect([bare.lampLabel, bare.process, bare.hours, bare.scheduledAt, bare.notes]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);

    const audit = await waitForAudit("production-orders.createProductionOrder", AuditOutcome.SUCCESS, first.id);
    expect(audit.summary).toBe(`Crear orden de producción OP0001-${YEAR}`);
  });

  it("la numeración continúa desde la mayor del año aunque se borren las intermedias", async () => {
    const a = unwrap(await createProductionOrder({ projectId }));
    unwrap(await createProductionOrder({ projectId }));
    const c = unwrap(await createProductionOrder({ projectId }));
    await prisma.productionOrder.delete({ where: { id: a.id } });

    const d = unwrap(await createProductionOrder({ projectId }));
    expect(c.number).toBe(`OP0003-${YEAR}`);
    expect(d.number).toBe(`OP0004-${YEAR}`);
    expect(await prisma.productionOrder.count()).toBe(3);
  });

  it("rechaza horas no positivas, proyecto inexistente y proceso desconocido sin consumir número", async () => {
    expectFail(await createProductionOrder({ projectId, hours: 0 }));
    expectFail(await createProductionOrder({ projectId, hours: -2 }));
    expect(expectFail(await createProductionOrder({ projectId: "no-existe" }))).toMatch(/no encontrado/);
    expectFail(await createProductionOrder({ projectId, process: "SOLDADURA" }));
    expect(await prisma.productionOrder.count()).toBe(0);

    // Tras los rechazos, la siguiente sigue siendo la 1.
    expect(unwrap(await createProductionOrder({ projectId })).number).toBe(`OP0001-${YEAR}`);
    await waitForAudit("production-orders.createProductionOrder", AuditOutcome.FAILURE);
  });

  it("solo admin y jefe de producción pueden crear OP", async () => {
    await loginAs(world.users.admin.email);
    unwrap(await createProductionOrder({ projectId }));

    await loginAs(world.users.ana.email);
    await expect(createProductionOrder({ projectId })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(await prisma.productionOrder.count()).toBe(1);
  });

  it("sin sesión no se crea nada", async () => {
    resetSession();
    await expect(createProductionOrder({ projectId })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.productionOrder.count()).toBe(0);
  });

  it("rechaza proyectos inactivos", async () => {
    unwrap(await toggleProjectActive({ projectId, isActive: false }));
    expect(expectFail(await createProductionOrder({ projectId }))).toMatch(/inactivo/);
    expect(await prisma.productionOrder.count()).toBe(0);
  });
});

describe("numeración concurrente", () => {
  it("cinco OP creadas a la vez reciben números distintos y correlativos", async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => createProductionOrder({ projectId })));

    expect(created.map((o) => unwrap(o).number).sort()).toEqual([1, 2, 3, 4, 5].map((n) => `OP000${n}-${YEAR}`));
    const rows = await prisma.productionOrder.findMany({ orderBy: { serial: "asc" } });
    expect(rows.map((r) => r.serial)).toEqual([1, 2, 3, 4, 5]);
  });

  it("cinco OT creadas a la vez reciben números distintos y correlativos", async () => {
    await loginAs(world.users.admin.email);
    const lamp = unwrap(
      await createLamp({
        projectId,
        name: "Araña",
        elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2: 1, units: 2 }],
      }),
    );
    const tasks = await prisma.task.findMany({ where: { lampId: lamp.id }, orderBy: { id: "asc" } });
    expect(tasks.length).toBeGreaterThanOrEqual(5);

    const results = await Promise.all(
      tasks.slice(0, 5).map((t) => createWorkOrder({ taskIds: [t.id] })),
    );

    const numbers = results.map((r) => unwrap(r).number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5].map((n) => `OT000${n}-${YEAR}`));
    const orders = await prisma.workOrder.findMany({ include: { tasks: true } });
    expect(orders).toHaveLength(5);
    expect(orders.every((o) => o.tasks.length === 1)).toBe(true);
  });
});
