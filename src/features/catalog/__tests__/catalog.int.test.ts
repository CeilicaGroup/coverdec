import { beforeEach, describe, expect, it } from "vitest";
import { ElementTypology, ProjectKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  createProcessDefinition,
  deleteElementType,
  deleteProcessDefinition,
  duplicateElementType,
  setElementTypeActive,
  updateProcessDefinition,
  updateTypologyDefaultNave,
  upsertElementType,
} from "@/features/catalog/actions";
import { getImportCatalogOptions } from "@/features/imports/actions";
import { createLamp, createProject } from "@/features/projects/actions";
import {
  buildWorld,
  expectFail,
  loginAs,
  resetSession,
  TELA_PROCESSES,
  unwrap,
  type World,
} from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
  await loginAs(world.users.jefe.email);
});

async function processesOf(code: string) {
  return prisma.elementTypeProcess.findMany({
    where: { elementType: { code } },
    orderBy: { sequence: "asc" },
    select: { process: true, sequence: true, hoursPerUnit: true, fixedHours: true, naveId: true },
  });
}

async function catalogSnapshot() {
  return prisma.elementType.findMany({
    orderBy: { code: "asc" },
    include: { processes: { orderBy: { sequence: "asc" } } },
  });
}

async function lampWithTela(name: string, surfaceM2 = 2, projectName = "Hotel Test") {
  const project =
    (await prisma.project.findFirst({ where: { name: projectName } })) ??
    (await createProject({ name: projectName, kind: ProjectKind.PRODUCCION, isBillable: true }));
  const lamp = await createLamp({
    projectId: project.id,
    name,
    elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2, units: 1 }],
  });
  return prisma.task.findMany({ where: { lampId: lamp.id }, orderBy: { order: "asc" } });
}

const telaInput = (processes: Array<{ process: string; hoursPerUnit: number; fixedHours?: number; naveId?: string | null }>) => ({
  code: "TELA",
  name: "Panel de tela",
  typology: ElementTypology.TELA,
  isActive: true,
  processes: processes.map((p) => ({ fixedHours: 0, ...p })),
});

describe("tipos de elemento", () => {
  it("al crear guarda los procesos en el orden indicado con horas/m² y fijas; al editar reordena y elimina los quitados", async () => {
    const created = unwrap(
      await upsertElementType({
        code: "ESPEJO",
        name: "Espejo redondo",
        typology: ElementTypology.ILUMINACION,
        isActive: true,
        processes: [
          { process: "PINTURA", hoursPerUnit: 0.3, fixedHours: 0 },
          { process: "CNC", hoursPerUnit: 0.5, fixedHours: 1, naveId: world.naves.n2.id },
        ],
      }),
    );
    expect(created.code).toBe("ESPEJO");
    expect(await processesOf("ESPEJO")).toEqual([
      { process: "PINTURA", sequence: 0, hoursPerUnit: 0.3, fixedHours: 0, naveId: null },
      { process: "CNC", sequence: 1, hoursPerUnit: 0.5, fixedHours: 1, naveId: world.naves.n2.id },
    ]);

    unwrap(
      await upsertElementType({
        code: "ESPEJO",
        name: "Espejo redondo XL",
        typology: ElementTypology.ILUMINACION,
        isActive: true,
        processes: [
          { process: "CNC", hoursPerUnit: 0.6, fixedHours: 1 },
          { process: "ENSAMBLAJE", hoursPerUnit: 1, fixedHours: 0 },
        ],
      }),
    );
    const espejo = await prisma.elementType.findUniqueOrThrow({ where: { code: "ESPEJO" } });
    expect(espejo.id).toBe(created.id); // edición en sitio, no un elemento nuevo
    expect(espejo.name).toBe("Espejo redondo XL");
    expect(await processesOf("ESPEJO")).toEqual([
      { process: "CNC", sequence: 0, hoursPerUnit: 0.6, fixedHours: 1, naveId: null },
      { process: "ENSAMBLAJE", sequence: 1, hoursPerUnit: 1, fixedHours: 0, naveId: null },
    ]);
  });

  it("rechaza procesos inexistentes o repetidos, horas negativas y naves inactivas, sin escribir nada", async () => {
    await prisma.nave.update({ where: { id: world.naves.n2.id }, data: { isActive: false } });
    const before = await catalogSnapshot();
    const base = { code: "NUEVO", name: "Nuevo", typology: ElementTypology.TELA, isActive: true };

    expect(
      expectFail(await upsertElementType({ ...base, processes: [{ process: "SOLDADURA", hoursPerUnit: 1, fixedHours: 0 }] })),
    ).toBe("Procesos no definidos en catálogo: SOLDADURA");
    expect(
      expectFail(
        await upsertElementType({
          ...base,
          processes: [
            { process: "CNC", hoursPerUnit: 1, fixedHours: 0 },
            { process: "CNC", hoursPerUnit: 2, fixedHours: 0 },
          ],
        }),
      ),
    ).toBe("Proceso duplicado");
    expectFail(await upsertElementType({ ...base, processes: [{ process: "CNC", hoursPerUnit: -1, fixedHours: 0 }] }));
    expectFail(await upsertElementType({ ...base, processes: [{ process: "CNC", hoursPerUnit: 1, fixedHours: -0.5 }] }));
    expect(expectFail(await upsertElementType({ ...base, processes: [], defaultNaveId: world.naves.n2.id }))).toBe(
      "La nave por defecto no está activa.",
    );
    expect(
      expectFail(
        await upsertElementType({
          ...base,
          processes: [{ process: "CNC", hoursPerUnit: 1, fixedHours: 0, naveId: world.naves.n2.id }],
        }),
      ),
    ).toBe("Alguna nave de proceso no está activa.");
    // Editar TELA con un proceso inválido tampoco toca sus procesos actuales.
    expectFail(await upsertElementType(telaInput([{ process: "SOLDADURA", hoursPerUnit: 1 }])));

    expect(await catalogSnapshot()).toEqual(before);
  });

  it("dar de alta un elemento con un código que ya existe no machaca el elemento existente", async () => {
    const before = await catalogSnapshot();
    const result = await upsertElementType({
      code: "TELA",
      name: "Otra cosa",
      typology: ElementTypology.ILUMINACION,
      isActive: true,
      isNew: true,
      processes: [{ process: "PINTURA", hoursPerUnit: 9, fixedHours: 0 }],
    });
    expect(expectFail(result)).toBe("Ya existe un elemento con el código «TELA».");
    expect(await catalogSnapshot()).toEqual(before);
  });

  it("cambiar las horas de catálogo no recalcula las tareas de lámparas ya creadas; las lámparas nuevas usan las nuevas", async () => {
    const oldTasks = await lampWithTela("Vieja", 2);
    const hoursBefore = TELA_PROCESSES.map((p) => p.hoursPerUnit * 2 + p.fixedHours); // 2, 2, 0.8
    expect(oldTasks.map((t) => t.estimatedHours)).toEqual(hoursBefore);

    unwrap(
      await upsertElementType(
        telaInput([
          { process: "CNC", hoursPerUnit: 1, fixedHours: 0.5 },
          { process: "ENSAMBLAJE", hoursPerUnit: 2 },
          { process: "PINTURA", hoursPerUnit: 0.4 },
        ]),
      ),
    );

    const reloaded = await prisma.task.findMany({ where: { id: { in: oldTasks.map((t) => t.id) } }, orderBy: { order: "asc" } });
    expect(reloaded.map((t) => [t.process, t.estimatedHours])).toEqual(
      oldTasks.map((t) => [t.process, t.estimatedHours]),
    );

    const newTasks = await lampWithTela("Nueva", 2);
    expect(newTasks.map((t) => [t.process, t.estimatedHours])).toEqual([
      ["CNC", 2.5],
      ["ENSAMBLAJE", 4],
      ["PINTURA", 0.8],
    ]);
  });

  it("archivar lo saca de las listas de alta pero conserva elemento, procesos y lámparas; se puede reactivar", async () => {
    const tasks = await lampWithTela("Araña");
    unwrap(await setElementTypeActive({ elementTypeId: world.tela.id, isActive: false }));

    const tela = await prisma.elementType.findUniqueOrThrow({ where: { id: world.tela.id } });
    expect(tela.isActive).toBe(false);
    expect(await processesOf("TELA")).toHaveLength(3);
    expect(await prisma.task.count({ where: { id: { in: tasks.map((t) => t.id) } } })).toBe(3);

    // Las listas de alta (p. ej. el selector de bastidores del importador) ya no lo ofrecen.
    await loginAs(world.users.admin.email);
    expect((await getImportCatalogOptions()).frames.map((f) => f.code)).not.toContain("TELA");

    // Tampoco se pueden dar de alta lámparas nuevas con él (las existentes siguen intactas).
    await expect(lampWithTela("Nueva")).rejects.toThrow(
      "«Panel de tela» está archivado en el catálogo. Reactívalo o elige otro elemento.",
    );
    expect(await prisma.lamp.count()).toBe(1);

    unwrap(await setElementTypeActive({ elementTypeId: world.tela.id, isActive: true }));
    expect((await getImportCatalogOptions()).frames.map((f) => f.code)).toContain("TELA");
    expect(await lampWithTela("Nueva")).toHaveLength(3);
  });

  it("editar un elemento archivado (horas, nombre) no lo reactiva", async () => {
    unwrap(await setElementTypeActive({ elementTypeId: world.tela.id, isActive: false }));

    // La pantalla de catálogo envía el estado real del elemento que edita…
    unwrap(await upsertElementType({ ...telaInput([{ process: "CNC", hoursPerUnit: 0.7 }]), isActive: false }));
    expect((await prisma.elementType.findUniqueOrThrow({ where: { id: world.tela.id } })).isActive).toBe(false);
    // …y si un cliente no lo envía, el servidor conserva el estado en vez de reactivarlo.
    const { isActive: _ignored, ...withoutState } = telaInput([{ process: "CNC", hoursPerUnit: 0.8 }]);
    void _ignored;
    unwrap(await upsertElementType(withoutState));
    const tela = await prisma.elementType.findUniqueOrThrow({ where: { id: world.tela.id } });
    expect(tela.isActive).toBe(false);
    expect(await processesOf("TELA")).toEqual([
      { process: "CNC", sequence: 0, hoursPerUnit: 0.8, fixedHours: 0, naveId: null },
    ]);
  });

  it("borrar solo se permite si ninguna lámpara lo usa; al borrar desaparecen también sus procesos", async () => {
    await lampWithTela("Araña");
    const blocked = expectFail(await deleteElementType({ elementTypeId: world.tela.id }));
    expect(blocked).toMatch(/^ARCHIVE_ONLY: Hay referencias activas \(1 lámpara\(s\), 1 elemento\(s\) de lámpara\)/);
    expect(await prisma.elementType.findUnique({ where: { id: world.tela.id } })).not.toBeNull();
    expect(await processesOf("TELA")).toHaveLength(3);

    const unused = unwrap(
      await upsertElementType({
        code: "SIN_USO",
        name: "Sin uso",
        typology: ElementTypology.TELA,
        isActive: true,
        processes: [{ process: "CNC", hoursPerUnit: 1, fixedHours: 0 }],
      }),
    );
    unwrap(await deleteElementType({ elementTypeId: unused.id }));
    expect(await prisma.elementType.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await prisma.elementTypeProcess.count({ where: { elementTypeId: unused.id } })).toBe(0);
  });

  it("duplicar copia procesos, horas, naves y operarios requeridos; el código va en mayúsculas y no puede repetirse", async () => {
    await prisma.elementTypeProcess.update({
      where: { elementTypeId_process: { elementTypeId: world.tela.id, process: "ENSAMBLAJE" } },
      data: { requiredWorkers: 2, naveId: world.naves.n2.id },
    });
    const copy = unwrap(await duplicateElementType({ elementTypeId: world.tela.id, code: " tela-xl ", name: " Tela XL " }));
    expect(copy.code).toBe("TELA-XL");

    const pick = (rows: Array<{ process: string; sequence: number; hoursPerUnit: number; fixedHours: number; naveId: string | null; requiredWorkers: number }>) =>
      rows.map(({ process, sequence, hoursPerUnit, fixedHours, naveId, requiredWorkers }) => ({
        process, sequence, hoursPerUnit, fixedHours, naveId, requiredWorkers,
      }));
    const source = await prisma.elementTypeProcess.findMany({ where: { elementTypeId: world.tela.id }, orderBy: { sequence: "asc" } });
    const copied = await prisma.elementTypeProcess.findMany({ where: { elementTypeId: copy.id }, orderBy: { sequence: "asc" } });
    expect(pick(copied)).toEqual(pick(source));
    const copyType = await prisma.elementType.findUniqueOrThrow({ where: { id: copy.id } });
    expect(copyType).toMatchObject({ name: "Tela XL", typology: ElementTypology.TELA, isActive: true });

    // La copia es independiente: editarla no cambia el original.
    unwrap(
      await upsertElementType({
        code: "TELA-XL",
        name: "Tela XL",
        typology: ElementTypology.TELA,
        isActive: true,
        processes: [{ process: "CNC", hoursPerUnit: 3, fixedHours: 0 }],
      }),
    );
    expect(await processesOf("TELA")).toHaveLength(3);

    expect(expectFail(await duplicateElementType({ elementTypeId: world.tela.id, code: "tela-xl", name: "Otra" }))).toBe(
      "Ya existe un elemento con el código «TELA-XL».",
    );
    expect(await prisma.elementType.count()).toBe(2);
  });
});

describe("definiciones de proceso", () => {
  it("crea procesos con código en formato CNC/PEGADO_ESPEJO y no admite códigos repetidos", async () => {
    unwrap(await createProcessDefinition({ code: "SOLDADURA", label: " Soldadura ", waitHours: 2 }));
    const soldadura = await prisma.processDefinition.findUniqueOrThrow({ where: { code: "SOLDADURA" } });
    expect(soldadura).toMatchObject({ label: "Soldadura", waitHours: 2, factor: 1, setupHours: 0 });

    expect(expectFail(await createProcessDefinition({ code: "soldadura fina", label: "x", waitHours: 0 }))).toBe(
      "Código tipo CNC, PEGADO_ESPEJO",
    );
    expect(expectFail(await createProcessDefinition({ code: "CNC", label: "CNC nuevo", waitHours: 5 }))).toBe(
      "Ya existe un proceso con el código «CNC».",
    );
    expect(await prisma.processDefinition.findUniqueOrThrow({ where: { code: "CNC" } })).toMatchObject({
      label: "CNC",
      waitHours: 0,
    });
  });

  it("editar un proceso cambia tiempo de secado y montaje; fuera de rango (> 1 semana) se rechaza", async () => {
    unwrap(
      await updateProcessDefinition({
        code: "PINTURA",
        label: "Pintura al horno",
        waitHours: 12,
        setupHours: 0.25,
        bgColor: "#fff",
        fgColor: "#000",
        borderColor: "#000",
        canFragment: false,
      }),
    );
    expect(await prisma.processDefinition.findUniqueOrThrow({ where: { code: "PINTURA" } })).toMatchObject({
      label: "Pintura al horno",
      waitHours: 12,
      setupHours: 0.25,
      canFragment: false,
    });

    expectFail(
      await updateProcessDefinition({
        code: "PINTURA",
        label: "Pintura",
        waitHours: 169,
        bgColor: "#fff",
        fgColor: "#000",
        borderColor: "#000",
        canFragment: true,
      }),
    );
    expect((await prisma.processDefinition.findUniqueOrThrow({ where: { code: "PINTURA" } })).waitHours).toBe(12);
  });

  it("no se puede borrar un proceso en uso (por elementos, tareas u operarios); uno sin uso sí", async () => {
    // PINTURA: lo usa TELA en catálogo y Bea como especialidad.
    expect(expectFail(await deleteProcessDefinition({ code: "PINTURA" }))).toBe(
      "PROCESS_IN_USE:No se puede eliminar: el proceso está en uso.",
    );
    // ESTIMACION_MANUAL no la usa nadie... hasta que una lámpara manual crea una tarea con ella.
    const project = await createProject({ name: "Manual", kind: ProjectKind.PROTOTIPO, isBillable: false });
    await createLamp({ projectId: project.id, name: "A ojo", estimatedHours: 5 });
    expect(await prisma.task.count({ where: { process: "ESTIMACION_MANUAL" } })).toBe(1);
    expectFail(await deleteProcessDefinition({ code: "ESTIMACION_MANUAL" }));
    expect(await prisma.processDefinition.findUnique({ where: { code: "ESTIMACION_MANUAL" } })).not.toBeNull();

    unwrap(await createProcessDefinition({ code: "SOLDADURA", label: "Soldadura", waitHours: 0 }));
    unwrap(await deleteProcessDefinition({ code: "SOLDADURA" }));
    expect(await prisma.processDefinition.findUnique({ where: { code: "SOLDADURA" } })).toBeNull();
  });
});

describe("nave por defecto de una tipología", () => {
  it("las lámparas nuevas de esa tipología van a la nave nueva; las ya creadas no se mueven", async () => {
    const oldTasks = await lampWithTela("Vieja");
    expect(oldTasks.every((t) => t.naveId === world.naves.n1.id)).toBe(true);

    unwrap(await updateTypologyDefaultNave({ typology: ElementTypology.TELA, defaultNaveId: world.naves.n2.id }));

    const newTasks = await lampWithTela("Nueva");
    expect(newTasks.every((t) => t.naveId === world.naves.n2.id)).toBe(true);
    const reloaded = await prisma.task.findMany({ where: { id: { in: oldTasks.map((t) => t.id) } } });
    expect(reloaded.every((t) => t.naveId === world.naves.n1.id)).toBe(true);
  });

  it("no acepta una nave inactiva", async () => {
    await prisma.nave.update({ where: { id: world.naves.n2.id }, data: { isActive: false } });
    expect(
      expectFail(await updateTypologyDefaultNave({ typology: ElementTypology.TELA, defaultNaveId: world.naves.n2.id })),
    ).toBe("La nave por defecto no está activa.");
    expect((await prisma.elementTypologyNave.findUniqueOrThrow({ where: { typology: ElementTypology.TELA } })).defaultNaveId).toBe(
      world.naves.n1.id,
    );
  });
});

describe("permisos del catálogo", () => {
  it("un operario no puede crear, editar, archivar, duplicar ni borrar nada del catálogo", async () => {
    const before = await catalogSnapshot();
    const processesBefore = await prisma.processDefinition.findMany({ orderBy: { code: "asc" } });
    await loginAs(world.users.ana.email);

    const attempts = [
      () => upsertElementType(telaInput([{ process: "CNC", hoursPerUnit: 99 }])),
      () => setElementTypeActive({ elementTypeId: world.tela.id, isActive: false }),
      () => duplicateElementType({ elementTypeId: world.tela.id, code: "COPIA", name: "Copia" }),
      () => deleteElementType({ elementTypeId: world.tela.id }),
      () => createProcessDefinition({ code: "SOLDADURA", label: "Soldadura", waitHours: 0 }),
      () => deleteProcessDefinition({ code: "IMPREVISTA" }),
      () => updateTypologyDefaultNave({ typology: ElementTypology.TELA, defaultNaveId: world.naves.n2.id }),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toThrow(/NEXT_REDIRECT/);
    }

    expect(await catalogSnapshot()).toEqual(before);
    expect(await prisma.processDefinition.findMany({ orderBy: { code: "asc" } })).toEqual(processesBefore);
  });

  it("sin sesión tampoco; jefe de producción y admin sí pueden editar el catálogo", async () => {
    resetSession();
    await expect(setElementTypeActive({ elementTypeId: world.tela.id, isActive: false })).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.elementType.findUniqueOrThrow({ where: { id: world.tela.id } })).isActive).toBe(true);

    await loginAs(world.users.jefe.email);
    unwrap(await setElementTypeActive({ elementTypeId: world.tela.id, isActive: false }));
    await loginAs(world.users.admin.email);
    unwrap(await setElementTypeActive({ elementTypeId: world.tela.id, isActive: true }));
    expect((await prisma.elementType.findUniqueOrThrow({ where: { id: world.tela.id } })).isActive).toBe(true);
  });
});
