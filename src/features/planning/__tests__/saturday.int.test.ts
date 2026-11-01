import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { generatePlanning } from "@/features/planning/service";
import { setSaturdayWork } from "@/features/planning/saturday-actions";
import { loadSaturdayWork, planningHorizonDays, weekHasSaturday } from "@/features/planning/saturday";
import { buildWorld, createPlannableLamp, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

const DAY_MS = 86_400_000;
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const day = (offset: number) => new Date(WEEK.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
const SATURDAY = day(5);
const MORNING = { startMinutes: 8 * 60, endMinutes: 14 * 60 };

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

describe("sábado laborable", () => {
  it("solo admite sábados y jefes; guarda quién trabaja y se puede quitar", async () => {
    await loginAs(world.users.jefe.email);
    expect(expectFail(await setSaturdayWork({ dateIso: day(4), personIds: [world.people.ana.id], ...MORNING }))).toMatch(
      /sábado/,
    );
    expect(
      expectFail(await setSaturdayWork({ dateIso: SATURDAY, personIds: [world.people.ana.id], startMinutes: 14 * 60, endMinutes: 8 * 60 })),
    ).toMatch(/posterior/);
    expect(await planningHorizonDays(WEEK)).toBe(5);

    unwrap(await setSaturdayWork({ dateIso: SATURDAY, personIds: [world.people.ana.id, world.people.bea.id], ...MORNING }));
    // Volver a guardar sustituye la lista: Bea deja de trabajar ese sábado.
    unwrap(await setSaturdayWork({ dateIso: SATURDAY, personIds: [world.people.ana.id], ...MORNING }));
    expect(await loadSaturdayWork(WEEK)).toEqual({ dateIso: SATURDAY, personIds: [world.people.ana.id], ...MORNING });
    expect(await planningHorizonDays(WEEK)).toBe(6);
    expect(await planningHorizonDays(WEEK, [world.naves.n2.id])).toBe(5);
    expect(await weekHasSaturday(WEEK)).toBe(true);

    unwrap(await setSaturdayWork({ dateIso: SATURDAY, personIds: [], ...MORNING }));
    expect(await loadSaturdayWork(WEEK)).toBeNull();
    expect(await prisma.personScheduleOverride.count()).toBe(0);

    await loginAs(world.users.ana.email);
    await expect(setSaturdayWork({ dateIso: SATURDAY, personIds: [world.people.ana.id], ...MORNING })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
  });

  it("sin habilitarlo, el sábado no es planificable", async () => {
    await createPlannableLamp(world);
    await expect(
      generatePlanning({
        naveId: world.naves.n1.id,
        weekStart: WEEK,
        planFrom: "DATE",
        planFromAt: new Date(`${SATURDAY}T00:00:00.000Z`),
      }),
    ).rejects.toThrow(/ningún día laborable/);
  });

  it("habilitado: lo que no cabe el viernes pasa al sábado, solo a quien trabaja y en su horario", async () => {
    // 16 m²: CNC 9 h → ensamblaje 16 h → pintura 6.4 h; desde el viernes no cabe en un día.
    await createPlannableLamp(world, { surfaceM2: 16 });
    await loginAs(world.users.admin.email);
    unwrap(await setSaturdayWork({ dateIso: SATURDAY, personIds: [world.people.ana.id], ...MORNING }));

    const generated = await generatePlanning({
      naveId: world.naves.n1.id,
      weekStart: WEEK,
      planFrom: "DATE",
      planFromAt: new Date(`${day(4)}T00:00:00.000Z`),
    });

    const planning = await prisma.planning.findUniqueOrThrow({ where: { id: generated.planningId } });
    expect(planning.weekEnd.toISOString().slice(0, 10)).toBe(SATURDAY);
    const rows = await prisma.planningAssignment.findMany({ where: { planningId: planning.id } });
    const saturdayRows = rows.filter((r) => r.date.toISOString().slice(0, 10) === SATURDAY);
    expect(saturdayRows.length).toBeGreaterThan(0);
    expect(new Set(saturdayRows.map((r) => r.personId))).toEqual(new Set([world.people.ana.id]));
    // Escala de franjas: 0 = 08:00, así que 08:00–14:00 son 0–6.
    expect(saturdayRows.every((r) => r.startSlot >= 0 && r.endSlot <= 6)).toBe(true);
    expect(saturdayRows.reduce((sum, r) => sum + r.hours, 0)).toBeLessThanOrEqual(6);
  }, 120_000);

  it("una semana sin sábado habilitado se planifica igual que siempre (lun–vie)", async () => {
    await createPlannableLamp(world);
    const generated = await generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });
    const planning = await prisma.planning.findUniqueOrThrow({ where: { id: generated.planningId } });
    expect(planning.weekEnd.toISOString().slice(0, 10)).toBe(day(4));
    const rows = await prisma.planningAssignment.findMany({ where: { planningId: planning.id } });
    expect(rows.some((r) => r.date.toISOString().slice(0, 10) === SATURDAY)).toBe(false);
  }, 120_000);
});
