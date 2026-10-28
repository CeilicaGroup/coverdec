import { beforeEach, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { requireDashboardContext } from "@/lib/context";
import { POST as switchNave } from "@/app/api/nave/switch/route";
import { assignLampToNave, createNave, getNaves, toggleNaveActive, updateNave } from "@/features/naves/actions";
import { createHoliday, deleteHoliday, updateHoliday } from "@/features/holidays/actions";
import { generatePlanning } from "@/features/planning/service";
import { publishPlanningAction } from "@/features/planning/actions";
import { buildWorld, createPlannableLamp, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

async function postSwitch(naveId: string) {
  const res = await switchNave(
    new Request("http://localhost/api/nave/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ naveId }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
}

const activeNaveOf = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).activeNaveId;

describe("naves: alta, edición y activación", () => {
  it("solo el admin crea y edita naves; el código es único", async () => {
    await loginAs(world.users.jefe.email);
    await expect(createNave({ codigo: "N3", nombre: "Nave 3" })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.nave.count()).toBe(2);

    await loginAs(world.users.admin.email);
    const { id } = await createNave({ codigo: "N3", nombre: "Nave 3" });
    await expect(createNave({ codigo: "N3", nombre: "Duplicada" })).rejects.toThrow();
    expect(await prisma.nave.count({ where: { codigo: "N3" } })).toBe(1);

    await updateNave({ naveId: id, codigo: "N3", nombre: "Nave tres" });
    expect((await prisma.nave.findUniqueOrThrow({ where: { id } })).nombre).toBe("Nave tres");
    await expect(updateNave({ naveId: id, codigo: "", nombre: "x" })).rejects.toThrow();
  });

  it("desactivar una nave la saca de las naves visibles de admin y jefe, y el jefe cae en otra activa", async () => {
    await prisma.user.update({ where: { id: world.users.jefe.id }, data: { activeNaveId: world.naves.n2.id } });
    await loginAs(world.users.jefe.email);
    expect((await requireDashboardContext()).naveId).toBe(world.naves.n2.id);

    await loginAs(world.users.admin.email);
    await toggleNaveActive(world.naves.n2.id, false);
    expect((await getNaves()).map((n) => n.codigo)).toEqual(["N1"]);
    expect((await requireDashboardContext()).naveIds).toEqual([world.naves.n1.id]);

    await loginAs(world.users.jefe.email);
    const jefe = await requireDashboardContext();
    expect(jefe.naveId).toBe(world.naves.n1.id);
    expect(jefe.naveIds).toEqual([world.naves.n1.id]);

    await loginAs(world.users.jefe.email);
    await expect(toggleNaveActive(world.naves.n2.id, true)).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.nave.findUniqueOrThrow({ where: { id: world.naves.n2.id } })).isActive).toBe(false);
  });
});

describe("cambiar de nave activa (User.activeNaveId)", () => {
  it("un operario solo puede elegir naves suyas", async () => {
    await loginAs(world.users.ana.email);
    expect(await postSwitch(world.naves.n2.id)).toEqual({ status: 403, body: { error: "NAVE_NOT_ALLOWED" } });
    expect(await activeNaveOf(world.users.ana.id)).toBeNull();

    expect((await postSwitch(world.naves.n1.id)).status).toBe(200);
    expect(await activeNaveOf(world.users.ana.id)).toBe(world.naves.n1.id);
    const ctx = await requireDashboardContext();
    expect(ctx.naveId).toBe(world.naves.n1.id);
    expect(ctx.naveIds).toEqual([world.naves.n1.id]);
  });

  it("vista global (sin nave) solo para admin; no se puede elegir una nave inactiva", async () => {
    await loginAs(world.users.jefe.email);
    expect(await postSwitch("")).toEqual({ status: 403, body: { error: "NAVE_REQUIRED" } });
    expect((await postSwitch(world.naves.n2.id)).status).toBe(200);
    expect((await requireDashboardContext()).naveId).toBe(world.naves.n2.id);

    await prisma.nave.update({ where: { id: world.naves.n1.id }, data: { isActive: false } });
    expect((await postSwitch(world.naves.n1.id)).status).toBe(404);
    expect(await activeNaveOf(world.users.jefe.id)).toBe(world.naves.n2.id);

    await loginAs(world.users.admin.email);
    expect((await postSwitch(world.naves.n2.id)).status).toBe(200);
    const filtered = await requireDashboardContext();
    expect(filtered.naveId).toBe(world.naves.n2.id);
    expect(filtered.naveIds).toEqual([world.naves.n2.id]);

    expect((await postSwitch("")).status).toBe(200);
    expect(await activeNaveOf(world.users.admin.id)).toBeNull();
    const global = await requireDashboardContext();
    expect(global.naveId).toBeNull();
    expect(global.role).toBe(Role.ADMIN);
  });

  it("con una nave filtrada el admin no puede publicar (el planning se publica para todas)", async () => {
    await createPlannableLamp(world);
    const week = getMondayOf(new Date(Date.now() + 14 * 86_400_000));
    await generatePlanning({ naveId: world.naves.n1.id, weekStart: week, planFrom: "WEEK_START" });

    await loginAs(world.users.admin.email);
    expect((await postSwitch(world.naves.n1.id)).status).toBe(200);
    expect(expectFail(await publishPlanningAction({ weekStart: week.toISOString().slice(0, 10) }))).toMatch(
      /todas las naves/,
    );
    expect(await prisma.planning.count({ where: { status: "PUBLISHED" } })).toBe(0);
  }, 120_000);
});

describe("asignar una lámpara a otra nave", () => {
  it("mueve todas sus tareas; un operario no puede", async () => {
    const lamp = await createPlannableLamp(world);
    await loginAs(world.users.ana.email);
    await expect(assignLampToNave(lamp.lampId, world.naves.n2.id)).rejects.toThrow(/NEXT_REDIRECT/);

    await loginAs(world.users.jefe.email);
    await assignLampToNave(lamp.lampId, world.naves.n2.id);
    const naves = await prisma.task.findMany({ where: { lampId: lamp.lampId }, select: { naveId: true } });
    expect(naves.length).toBe(3);
    expect(new Set(naves.map((t) => t.naveId))).toEqual(new Set([world.naves.n2.id]));
  });
});

describe("festivos", () => {
  it("crear, editar y borrar; fechas normalizadas al día y nombre recortado", async () => {
    await loginAs(world.users.jefe.email);
    unwrap(await createHoliday({ startDate: "2026-12-24", endDate: "2026-12-26", name: "  Navidad " }));
    const h = await prisma.holiday.findFirstOrThrow();
    expect(h.name).toBe("Navidad");
    expect(h.startDate.toISOString()).toBe("2026-12-24T00:00:00.000Z");
    expect(h.endDate.toISOString()).toBe("2026-12-26T00:00:00.000Z");

    unwrap(await updateHoliday({ id: h.id, startDate: "2026-12-25", endDate: "2026-12-25", name: "Navidad" }));
    const edited = await prisma.holiday.findUniqueOrThrow({ where: { id: h.id } });
    expect([edited.startDate.toISOString(), edited.endDate.toISOString()]).toEqual([
      "2026-12-25T00:00:00.000Z",
      "2026-12-25T00:00:00.000Z",
    ]);

    unwrap(await deleteHoliday({ id: h.id }));
    expect(await prisma.holiday.count()).toBe(0);
  });

  it("rechaza fin anterior al inicio, nombre vacío y fechas mal formadas; un operario no puede tocarlos", async () => {
    await loginAs(world.users.admin.email);
    expect(
      expectFail(await createHoliday({ startDate: "2026-12-26", endDate: "2026-12-24", name: "Al revés" })),
    ).toMatch(/posterior al inicio/);
    expectFail(await createHoliday({ startDate: "2026-12-24", endDate: "2026-12-24", name: "" }));
    expectFail(await createHoliday({ startDate: "24/12/2026", endDate: "2026-12-24", name: "x" }));
    unwrap(await createHoliday({ startDate: "2026-12-24", endDate: "2026-12-24", name: "Nochebuena" }));
    const h = await prisma.holiday.findFirstOrThrow();
    expect(
      expectFail(await updateHoliday({ id: h.id, startDate: "2026-12-25", endDate: "2026-12-24", name: "x" })),
    ).toMatch(/posterior al inicio/);

    await loginAs(world.users.ana.email);
    await expect(createHoliday({ startDate: "2026-12-31", endDate: "2026-12-31", name: "Nochevieja" })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    await expect(deleteHoliday({ id: h.id })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.holiday.findMany({ select: { name: true } })).toEqual([{ name: "Nochebuena" }]);
  });

  it("un festivo de varios días bloquea todos esos días del planning y solo esos", async () => {
    await createPlannableLamp(world, { surfaceM2: 8 });
    const week = getMondayOf(new Date(Date.now() + 14 * 86_400_000));
    const iso = (offset: number) => new Date(week.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    await loginAs(world.users.jefe.email);
    unwrap(await createHoliday({ startDate: iso(0), endDate: iso(1), name: "Fiestas locales" }));

    await generatePlanning({ naveId: world.naves.n1.id, weekStart: week, planFrom: "WEEK_START" });
    const days = new Set(
      (await prisma.planningAssignment.findMany({ select: { date: true } })).map((a) => a.date.toISOString().slice(0, 10)),
    );
    expect(days.size).toBeGreaterThan(0);
    expect(days.has(iso(0))).toBe(false);
    expect(days.has(iso(1))).toBe(false);
    expect(days.has(iso(2))).toBe(true);
  }, 120_000);
});
