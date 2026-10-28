import { beforeEach, describe, expect, it } from "vitest";
import { ElementTypology, ProjectApprovalStatus, ProjectKind, TaskSystemKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { createLamp, createProject, setLampApprovedForPlanning } from "@/features/projects/actions";
import { buildWorld, loginAs, TELA_PROCESSES, type World } from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
});

async function newProject(name = "Hotel Test") {
  return createProject({ name, kind: ProjectKind.PRODUCCION, isBillable: true });
}

function telaElement(surfaceM2: number, units: number) {
  return [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2, units }];
}

describe("crear lámpara de catálogo", () => {
  it("genera una tarea por proceso y por unidad física, con horas de catálogo y cadena ordenada", async () => {
    await loginAs(world.users.jefe.email);
    const project = await newProject();

    const lamp = await createLamp({ projectId: project.id, name: "Araña", elements: telaElement(2.5, 2) });

    const elements = await prisma.lampElement.findMany({
      where: { lampId: lamp.id },
      include: { tasks: { orderBy: { order: "asc" } } },
      orderBy: { label: "asc" },
    });
    // Dos unidades se guardan como dos elementos físicos, nunca agregados.
    expect(elements).toHaveLength(2);

    for (const element of elements) {
      expect(element.tasks.map((t) => t.process)).toEqual(["CNC", "ENSAMBLAJE", "PINTURA"]);
      expect(element.tasks.map((t) => t.estimatedHours)).toEqual(
        TELA_PROCESSES.map((p) => p.hoursPerUnit * 2.5 + p.fixedHours), // 2.25, 2.5, 1
      );
      // Cada unidad física es su propia cadena (el bloqueo va por lampElementId).
      expect(element.tasks.map((t) => t.order)).toEqual([0, 1, 2]);
      expect(element.tasks.every((t) => t.naveId === world.naves.n1.id)).toBe(true);
    }

    const total = await prisma.task.aggregate({ where: { lampId: lamp.id }, _sum: { estimatedHours: true } });
    expect(total._sum.estimatedHours).toBeCloseTo(2 * (2.25 + 2.5 + 1));
  });

  it("inserta una tarea de transporte cuando un proceso se hace en otra nave", async () => {
    await prisma.elementTypeProcess.update({
      where: { elementTypeId_process: { elementTypeId: world.tela.id, process: "PINTURA" } },
      data: { naveId: world.naves.n2.id },
    });
    await loginAs(world.users.jefe.email);
    const project = await newProject();

    const lamp = await createLamp({ projectId: project.id, name: "Araña", elements: telaElement(1, 1) });

    const tasks = await prisma.task.findMany({ where: { lampId: lamp.id }, orderBy: { order: "asc" } });
    expect(tasks.map((t) => t.process)).toEqual(["CNC", "ENSAMBLAJE", "TRANSPORTE", "PINTURA"]);
    const transport = tasks[2]!;
    expect(transport.systemKind).toBe(TaskSystemKind.TRANSPORT);
    expect(transport.transportFromNaveId).toBe(world.naves.n1.id);
    expect(transport.transportToNaveId).toBe(world.naves.n2.id);
    expect(tasks[3]!.naveId).toBe(world.naves.n2.id);
  });

  it("rechaza un nombre de lámpara repetido en el mismo proyecto (sin crear duplicados)", async () => {
    await loginAs(world.users.jefe.email);
    const project = await newProject();
    await createLamp({ projectId: project.id, name: "Araña", elements: telaElement(1, 1) });

    await expect(
      createLamp({ projectId: project.id, name: "araña", elements: telaElement(1, 1) }),
    ).rejects.toThrow(/Ya existe una lámpara/);
    expect(await prisma.lamp.count({ where: { projectId: project.id } })).toBe(1);
  });

  it("un operario no puede crear proyectos", async () => {
    await loginAs(world.users.ana.email);
    await expect(newProject()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.project.count()).toBe(0);
  });

  it("sin sesión no se puede crear nada", async () => {
    await expect(newProject()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.project.count()).toBe(0);
  });
});

describe("aprobación para planning", () => {
  it("el proyecto queda aprobado solo cuando todas sus lámparas lo están", async () => {
    await loginAs(world.users.admin.email);
    const project = await newProject();
    const a = await createLamp({ projectId: project.id, name: "A", elements: telaElement(1, 1) });
    const b = await createLamp({ projectId: project.id, name: "B", elements: telaElement(1, 1) });
    const status = async () =>
      (await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).approvalStatus;

    expect(await status()).toBe(ProjectApprovalStatus.PENDING_APPROVAL);
    await setLampApprovedForPlanning({ lampId: a.id, isApprovedForPlanning: true });
    expect(await status()).toBe(ProjectApprovalStatus.PARTIAL_APPROVAL);
    await setLampApprovedForPlanning({ lampId: b.id, isApprovedForPlanning: true });
    expect(await status()).toBe(ProjectApprovalStatus.IN_PRODUCTION);
    // Desaprobar una vuelve a parcial.
    await setLampApprovedForPlanning({ lampId: a.id, isApprovedForPlanning: false });
    expect(await status()).toBe(ProjectApprovalStatus.PARTIAL_APPROVAL);
  });

  it("solo un admin puede aprobar lámparas", async () => {
    await loginAs(world.users.jefe.email);
    const project = await newProject();
    const lamp = await createLamp({ projectId: project.id, name: "A", elements: telaElement(1, 1) });

    await expect(
      setLampApprovedForPlanning({ lampId: lamp.id, isApprovedForPlanning: true }),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await prisma.lamp.findUniqueOrThrow({ where: { id: lamp.id } })).isApprovedForPlanning).toBe(false);
  });
});
