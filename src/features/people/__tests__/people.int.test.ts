import { beforeEach, describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { createUser } from "@/features/admin/users-actions";
import {
  deleteAbsence,
  deletePerson,
  savePerson,
  savePersonWorkWindows,
  setAbsence,
} from "@/features/people/actions";
import { generatePlanning } from "@/features/planning/service";
import { addTaskSubstitute, removeTaskSubstitute } from "@/features/projects/substitute-actions";
import { buildWorld, createPlannableLamp, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

// Semana fija: lunes 2 – domingo 8 de noviembre de 2026.
const MON = "2026-11-02";
const TUE = "2026-11-03";
const WED = "2026-11-04";
const FRI = "2026-11-06";
const SUN = "2026-11-08";

/** Horas de horario de una persona en un día ISO (1=lunes … 5=viernes), leídas de BD. */
async function dayHours(personId: string, isoWeekday: number) {
  const windows = await prisma.personWorkWindow.findMany({ where: { personId, dayOfWeek: isoWeekday } });
  return windows.reduce((s, w) => s + (w.endMinutes - w.startMinutes), 0) / 60;
}

async function newOperarioUser(email: string) {
  await loginAs(world.users.admin.email);
  unwrap(await createUser({ name: "Nuevo", email, password: "integration-pass-123", role: Role.OPERARIO }));
  return prisma.user.findUniqueOrThrow({ where: { email } });
}

const basePerson = {
  color: "#123456",
  hourlyRate: 15,
  overtimeHourlyRate: 22,
  isActive: true,
  specialties: [] as { process: string; mode: "responsable" | "apoyo" }[],
};

describe("alta y edición de personas", () => {
  it("crea la persona con iniciales normalizadas, una nave, especialidades y usuario vinculado", async () => {
    const user = await newOperarioUser("dani@test.local");
    await loginAs(world.users.jefe.email);

    unwrap(
      await savePerson({
        ...basePerson,
        iniciales: "  dmo ",
        alias: "  Dani ",
        naveIds: [world.naves.n2.id],
        userId: user.id,
        specialties: [
          { process: "CNC", mode: "responsable" },
          { process: "PINTURA", mode: "apoyo" },
        ],
      }),
    );

    const person = await prisma.person.findUniqueOrThrow({
      where: { iniciales: "DMO" },
      include: { personNaves: true, specialties: { orderBy: { process: "asc" } }, user: true },
    });
    expect(person.alias).toBe("Dani");
    expect(person.personNaves.map((n) => n.naveId)).toEqual([world.naves.n2.id]);
    expect(person.specialties.map((s) => [s.process, s.isPrimary, s.isFallback])).toEqual([
      ["CNC", true, false],
      ["PINTURA", false, true],
    ]);
    expect(person.user?.id).toBe(user.id);
  });

  it("rechaza iniciales repetidas (sin distinguir mayúsculas) sin dejar nada a medias", async () => {
    const user = await newOperarioUser("dani@test.local");
    const peopleBefore = await prisma.person.count();

    const fail = expectFail(
      await savePerson({ ...basePerson, iniciales: "ana", naveIds: [world.naves.n1.id], userId: user.id }),
    );
    expect(fail).toMatch(/iniciales ya están en uso/);
    expect(await prisma.person.count()).toBe(peopleBefore);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).personId).toBeNull();
  });

  it("valida especialidades duplicadas y exactamente una nave", async () => {
    const user = await newOperarioUser("dani@test.local");
    const input = { ...basePerson, iniciales: "DMO", userId: user.id };

    expect(
      expectFail(
        await savePerson({
          ...input,
          naveIds: [world.naves.n1.id],
          specialties: [
            { process: "CNC", mode: "responsable" },
            { process: "CNC", mode: "apoyo" },
          ],
        }),
      ),
    ).toMatch(/duplicado/);
    expectFail(await savePerson({ ...input, naveIds: [world.naves.n1.id, world.naves.n2.id] }));
    expectFail(await savePerson({ ...input, naveIds: [] }));
    expect(await prisma.person.count({ where: { iniciales: "DMO" } })).toBe(0);
  });

  it("editar reemplaza nave y especialidades, y el operario pasa a ver solo su nueva nave", async () => {
    await loginAs(world.users.admin.email);
    unwrap(
      await savePerson({
        ...basePerson,
        id: world.people.ana.id,
        iniciales: "ANA",
        naveIds: [world.naves.n2.id],
        userId: world.users.ana.id,
        specialties: [{ process: "PINTURA", mode: "responsable" }],
      }),
    );

    const ana = await prisma.person.findUniqueOrThrow({
      where: { id: world.people.ana.id },
      include: { personNaves: true, specialties: true },
    });
    expect(ana.personNaves.map((n) => n.naveId)).toEqual([world.naves.n2.id]);
    expect(ana.specialties.map((s) => s.process)).toEqual(["PINTURA"]);
    // El horario no se toca al editar la ficha.
    expect(await dayHours(ana.id, 2)).toBeGreaterThan(0);

    // Con la nave cambiada, Ana ya no puede fichar en tareas de N1.
    const lamp = await createPlannableLamp(world);
    await loginAs(world.users.ana.email);
    const { createManualEntry } = await import("@/features/time-tracking/actions");
    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;
    expect(
      expectFail(
        await createManualEntry({
          projectId: lamp.projectId,
          lampId: lamp.lampId,
          taskId: cnc.id,
          process: "CNC",
          startedAt: "2026-10-20T08:00:00.000Z",
          hours: 1,
        }),
      ),
    ).toMatch(/nave/);
  });

  it("vincular otro usuario a la persona desvincula al anterior", async () => {
    const user = await newOperarioUser("ana2@test.local");
    unwrap(
      await savePerson({
        ...basePerson,
        id: world.people.ana.id,
        iniciales: "ANA",
        naveIds: [world.naves.n1.id],
        userId: user.id,
      }),
    );
    expect((await prisma.user.findUniqueOrThrow({ where: { id: world.users.ana.id } })).personId).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).personId).toBe(world.people.ana.id);
  });

  it("no deja vincular un usuario que ya es de otra persona (ni al editar ni al dar de alta)", async () => {
    await loginAs(world.users.jefe.email);
    expect(
      expectFail(
        await savePerson({ ...basePerson, id: world.people.bea.id, iniciales: "BEA", naveIds: [world.naves.n1.id], userId: world.users.ana.id }),
      ),
    ).toMatch(/ya está vinculado a ANA/);
    expect(
      expectFail(await savePerson({ ...basePerson, iniciales: "NUE", naveIds: [world.naves.n1.id], userId: world.users.ana.id })),
    ).toMatch(/ya está vinculado a ANA/);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: world.users.ana.id } })).personId).toBe(world.people.ana.id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: world.users.bea.id } })).personId).toBe(world.people.bea.id);
    expect(await prisma.person.count({ where: { iniciales: "NUE" } })).toBe(0);

    // Guardar la persona con su propio usuario sigue funcionando.
    unwrap(
      await savePerson({ ...basePerson, id: world.people.bea.id, iniciales: "BEA", naveIds: [world.naves.n1.id], userId: world.users.bea.id }),
    );
  });

  it("un operario no puede dar de alta ni editar personas", async () => {
    await loginAs(world.users.ana.email);
    await expect(
      savePerson({ ...basePerson, id: world.people.bea.id, iniciales: "BEA", naveIds: [world.naves.n2.id], userId: world.users.bea.id }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const bea = await prisma.person.findUniqueOrThrow({ where: { id: world.people.bea.id }, include: { personNaves: true } });
    expect(bea.personNaves.map((n) => n.naveId)).toEqual([world.naves.n1.id]);
  });

  it("borrar: solo personas sin usuario ni planning; si no, solo se pueden desactivar", async () => {
    await loginAs(world.users.admin.email);
    expect(expectFail(await deletePerson({ personId: world.people.ana.id }))).toMatch(/ARCHIVE_ONLY/);
    expect(await prisma.person.count({ where: { id: world.people.ana.id } })).toBe(1);

    // Sin usuario vinculado y sin planning, se borra con sus especialidades y nave.
    await prisma.user.update({ where: { id: world.users.carl.id }, data: { personId: null } });
    unwrap(await deletePerson({ personId: world.people.carl.id }));
    expect(await prisma.person.count({ where: { id: world.people.carl.id } })).toBe(0);
    expect(await prisma.personSpecialty.count({ where: { personId: world.people.carl.id } })).toBe(0);
    expect(await prisma.personNave.count({ where: { personId: world.people.carl.id } })).toBe(0);
  });
});

describe("horario laboral", () => {
  it("reemplaza las franjas y rechaza franjas invertidas o solapadas", async () => {
    await loginAs(world.users.jefe.email);
    const id = world.people.bea.id;
    unwrap(await savePersonWorkWindows({
      personId: id,
      windows: [
        { dayOfWeek: 1, startMinutes: 7 * 60, endMinutes: 15 * 60 },
        { dayOfWeek: 2, startMinutes: 7 * 60, endMinutes: 13 * 60 },
      ],
    }));
    expect(await prisma.personWorkWindow.count({ where: { personId: id } })).toBe(2);
    expect(await dayHours(id, 1)).toBe(8);
    expect(await dayHours(id, 2)).toBe(6);

    expect(
      expectFail(
        await savePersonWorkWindows({ personId: id, windows: [{ dayOfWeek: 3, startMinutes: 600, endMinutes: 600 }] }),
      ),
    ).toMatch(/fin posterior/);
    // Dos franjas que se pisan el mismo día inflarían la capacidad (8–14 + 10–16 ≠ 14h).
    expect(
      expectFail(
        await savePersonWorkWindows({
          personId: id,
          windows: [
            { dayOfWeek: 3, startMinutes: 8 * 60, endMinutes: 14 * 60 },
            { dayOfWeek: 3, startMinutes: 10 * 60, endMinutes: 16 * 60 },
          ],
        }),
      ),
    ).toMatch(/solapan/);
    // Ninguno de los intentos fallidos borró el horario anterior.
    expect(await dayHours(id, 1)).toBe(8);

    await loginAs(world.users.bea.email);
    await expect(savePersonWorkWindows({ personId: id, windows: [] })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.personWorkWindow.count({ where: { personId: id } })).toBe(2);
  });
});

describe("ausencias", () => {
  const ana = () => world.people.ana.id;

  beforeEach(async () => {
    await loginAs(world.users.jefe.email);
  });

  it("día completo: guarda las horas de horario de ese día", async () => {
    unwrap(await setAbsence({ personId: ana(), date: TUE, mode: "day", reason: "Médico" }));
    const a = await prisma.absence.findFirstOrThrow({ where: { personId: ana() } });
    expect(a.date.toISOString().slice(0, 10)).toBe(TUE);
    expect(a.endDate.toISOString().slice(0, 10)).toBe(TUE);
    expect(a.hours).toBeCloseTo(await dayHours(ana(), 2));
    expect(a.reason).toBe("Médico");
  });

  it("rango: suma solo los días laborables (el fin de semana no cuenta)", async () => {
    let weekdays = 0;
    for (let d = 1; d <= 5; d++) weekdays += await dayHours(ana(), d);

    unwrap(await setAbsence({ personId: ana(), date: MON, endDate: FRI, mode: "range", reason: "Vacaciones" }));
    const workweek = await prisma.absence.findFirstOrThrow({ where: { personId: ana() } });
    expect(workweek.hours).toBeCloseTo(weekdays);

    unwrap(await setAbsence({ id: workweek.id, personId: ana(), date: MON, endDate: SUN, mode: "range", reason: "Vacaciones" }));
    const fullWeek = await prisma.absence.findUniqueOrThrow({ where: { id: workweek.id } });
    expect(fullWeek.endDate.toISOString().slice(0, 10)).toBe(SUN);
    expect(fullWeek.hours).toBeCloseTo(weekdays);
  });

  it("franja: cuenta solo lo que pisa el horario y rechaza franjas fuera de él o invertidas", async () => {
    // Martes 08:00–10:00 está dentro de la mañana del horario por defecto.
    unwrap(
      await setAbsence({ personId: ana(), date: TUE, mode: "block", reason: "Gestión", blockStartMinutes: 8 * 60, blockEndMinutes: 10 * 60 }),
    );
    expect((await prisma.absence.findFirstOrThrow({ where: { personId: ana() } })).hours).toBe(2);

    expect(
      expectFail(
        await setAbsence({ personId: ana(), date: WED, mode: "block", reason: "Noche", blockStartMinutes: 22 * 60, blockEndMinutes: 23 * 60 }),
      ),
    ).toMatch(/no intersecta/);
    expect(
      expectFail(
        await setAbsence({ personId: ana(), date: WED, mode: "block", reason: "Mal", blockStartMinutes: 600, blockEndMinutes: 540 }),
      ),
    ).toMatch(/terminar después/);
    expect(await prisma.absence.count()).toBe(1);
  });

  it("no admite ausencias que se solapan para la misma persona, pero sí para otra; editar no choca consigo misma", async () => {
    unwrap(await setAbsence({ personId: ana(), date: WED, mode: "day", reason: "Médico" }));
    const original = await prisma.absence.findFirstOrThrow();

    expect(
      expectFail(await setAbsence({ personId: ana(), date: MON, endDate: FRI, mode: "range", reason: "Vacaciones" })),
    ).toMatch(/solapa/);
    expect(
      expectFail(
        await setAbsence({ personId: ana(), date: WED, mode: "block", reason: "Otra", blockStartMinutes: 600, blockEndMinutes: 660 }),
      ),
    ).toMatch(/solapa/);
    expect(await prisma.absence.count()).toBe(1);

    unwrap(await setAbsence({ personId: world.people.bea.id, date: MON, endDate: FRI, mode: "range", reason: "Vacaciones" }));

    // Ampliar la propia ausencia a un rango no choca consigo misma.
    unwrap(await setAbsence({ id: original.id, personId: ana(), date: TUE, endDate: WED, mode: "range", reason: "Médico" }));
    const edited = await prisma.absence.findMany({ where: { personId: ana() } });
    expect(edited).toHaveLength(1);
    expect(edited[0]!.date.toISOString().slice(0, 10)).toBe(TUE);
  });

  it("valida rangos: fin anterior al inicio, sin fecha fin o de más de un año", async () => {
    expect(
      expectFail(await setAbsence({ personId: ana(), date: FRI, endDate: MON, mode: "range", reason: "x" })),
    ).toMatch(/posterior al inicio/);
    expect(expectFail(await setAbsence({ personId: ana(), date: FRI, mode: "range", reason: "x" }))).toMatch(/fecha fin/);
    expect(
      expectFail(await setAbsence({ personId: ana(), date: "2026-01-01", endDate: "2027-01-03", mode: "range", reason: "x" })),
    ).toMatch(/366/);
    expect(expectFail(await setAbsence({ personId: ana(), date: FRI, mode: "day", reason: "   " }))).toMatch(/motivo/);
    expect(await prisma.absence.count()).toBe(0);
  });

  it("borrar exige que la ausencia sea de esa persona; un operario no puede gestionar ausencias", async () => {
    unwrap(await setAbsence({ personId: ana(), date: TUE, mode: "day", reason: "Médico" }));
    const absence = await prisma.absence.findFirstOrThrow();

    unwrap(await deleteAbsence({ id: absence.id, personId: world.people.bea.id, date: TUE }));
    expect(await prisma.absence.count()).toBe(1);

    await loginAs(world.users.ana.email);
    await expect(setAbsence({ personId: ana(), date: WED, mode: "day", reason: "Me lo pongo yo" })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    await expect(deleteAbsence({ id: absence.id, personId: ana(), date: TUE })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.absence.count()).toBe(1);

    await loginAs(world.users.admin.email);
    unwrap(await deleteAbsence({ id: absence.id, personId: ana(), date: TUE }));
    expect(await prisma.absence.count()).toBe(0);
  });
});

describe("sustitutos en tareas planificadas", () => {
  it("solo en tareas ya planificadas, con personas activas de la misma nave; añadir es idempotente", async () => {
    const lamp = await createPlannableLamp(world);
    const cnc = lamp.tasks.find((t) => t.process === "CNC")!;
    await loginAs(world.users.jefe.email);

    expect(expectFail(await addTaskSubstitute({ taskId: cnc.id, personId: world.people.bea.id }))).toMatch(/ya planificada/);

    const week = getMondayOf(new Date(Date.now() + 14 * 86_400_000));
    await generatePlanning({ naveId: world.naves.n1.id, weekStart: week, planFrom: "WEEK_START" });
    await loginAs(world.users.jefe.email);

    expect(expectFail(await addTaskSubstitute({ taskId: cnc.id, personId: world.people.carl.id }))).toMatch(/misma nave/);
    unwrap(await addTaskSubstitute({ taskId: cnc.id, personId: world.people.bea.id }));
    unwrap(await addTaskSubstitute({ taskId: cnc.id, personId: world.people.bea.id }));
    expect(await prisma.taskParticipant.findMany({ where: { taskId: cnc.id }, select: { personId: true } })).toEqual([
      { personId: world.people.bea.id },
    ]);

    await loginAs(world.users.ana.email);
    await expect(removeTaskSubstitute({ taskId: cnc.id, personId: world.people.bea.id })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.taskParticipant.count()).toBe(1);

    await loginAs(world.users.admin.email);
    unwrap(await removeTaskSubstitute({ taskId: cnc.id, personId: world.people.bea.id }));
    expect(await prisma.taskParticipant.count()).toBe(0);
  }, 120_000);
});
