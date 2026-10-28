import { beforeEach, describe, expect, it } from "vitest";
import {
  ElementTypology,
  LampElementStockStatus,
  ProjectApprovalStatus,
  ProjectKind,
  WorkOrderStatus,
} from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import { generatePlanning } from "@/features/planning/service";
import {
  createLamp,
  createProject,
  setLampApprovedForPlanning,
  toggleProjectActive,
} from "@/features/projects/actions";
import { createManualEntry } from "@/features/time-tracking/actions";
import { autoGroupIdenticalTasks, deleteWorkOrder, updateWorkOrder } from "@/features/work-orders/actions";
import {
  assignLampFromStockToProject,
  createStockBatch,
  deleteStockLamp,
  listStockLamps,
  returnLampToStock,
} from "@/features/stock/actions";
import {
  buildWorld,
  createPlannableLamp,
  loginAs,
  TELA_PROCESSES,
  unwrap,
  type World,
} from "@/test/integration/world";

const DAY_MS = 86_400_000;
const WEEK = getMondayOf(new Date(Date.now() + 14 * DAY_MS));
const YEAR = new Date().getUTCFullYear();
/** Horas de catálogo de una unidad TELA de 2 m²: CNC 2h, ENSAMBLAJE 2h, PINTURA 0.8h. */
const TELA_2M2_HOURS = TELA_PROCESSES.map((p) => p.hoursPerUnit * 2 + p.fixedHours);

let world: World;
let poolId: string;

/** El pool STOCK-POOL lo crea una migración de datos; el TRUNCATE de setup lo borra, así que se recrea igual. */
async function createStockPool() {
  const pool = await prisma.project.create({
    data: {
      code: "STOCK-POOL",
      name: "Pool de stock",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.STOCK,
    },
  });
  return pool.id;
}

beforeEach(async () => {
  world = await buildWorld();
  poolId = await createStockPool();
});

function telaElements(units = 1, surfaceM2 = 2) {
  return [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2, units }];
}

async function newProject(name: string) {
  return createProject({ name, kind: ProjectKind.PRODUCCION, isBillable: true });
}

async function lampState(lampId: string) {
  return prisma.lamp.findUniqueOrThrow({
    where: { id: lampId },
    include: {
      elements: { orderBy: { label: "asc" } },
      tasks: { orderBy: [{ lampElementId: "asc" }, { order: "asc" }] },
    },
  });
}

/** Invariante: una lámpara y todas sus tareas viven siempre en el mismo proyecto. */
async function expectTasksFollowLamp(lampId: string) {
  const lamp = await lampState(lampId);
  expect(lamp.tasks.length).toBeGreaterThan(0);
  for (const task of lamp.tasks) expect(task.projectId).toBe(lamp.projectId);
  return lamp;
}

describe("crear lote de stock", () => {
  it("crea la lámpara en el pool con una unidad física por elemento, en producción y con código de lote", async () => {
    await loginAs(world.users.jefe.email);
    const { id } = await createStockBatch({ name: "Panel stock", elements: telaElements(2) });

    const lamp = await expectTasksFollowLamp(id);
    expect(lamp.projectId).toBe(poolId);
    expect(lamp.units).toBe(2);
    // Lo fabricado para stock no entra solo en el planning: hay que aprobarlo.
    expect(lamp.isApprovedForPlanning).toBe(false);
    expect(lamp.elements).toHaveLength(2);
    for (const element of lamp.elements) {
      expect(element.stockStatus).toBe(LampElementStockStatus.IN_PRODUCTION);
      expect(element.stockBatchCode).toBe(`SB-0001-${YEAR}`);
      const tasks = lamp.tasks.filter((t) => t.lampElementId === element.id);
      expect(tasks.map((t) => t.process)).toEqual(["CNC", "ENSAMBLAJE", "PINTURA"]);
      expect(tasks.map((t) => t.estimatedHours)).toEqual(TELA_2M2_HOURS);
      expect(tasks.every((t) => !t.isCompleted && t.workOrderId === null)).toBe(true);
    }

    const [listed] = await listStockLamps();
    expect(listed!.id).toBe(id);
    expect(listed!.stockStatus).toBe(LampElementStockStatus.IN_PRODUCTION);
    expect(listed!.batchCodes).toEqual([`SB-0001-${YEAR}`]);
    // Horas pendientes = suma de las tareas no completadas de ambas unidades.
    expect(listed!.pendingHours).toBeCloseTo(2 * TELA_2M2_HOURS.reduce((a, b) => a + b, 0));
    expect(listed!.canHardDelete).toBe(true);
  });

  it("numera los lotes de forma correlativa y comparte el código entre las unidades del mismo lote", async () => {
    await loginAs(world.users.admin.email);
    const a = await createStockBatch({ name: "Lote A", elements: telaElements(2) });
    const b = await createStockBatch({ name: "Lote B", elements: telaElements(1) });

    const codesA = (await lampState(a.id)).elements.map((e) => e.stockBatchCode);
    const codesB = (await lampState(b.id)).elements.map((e) => e.stockBatchCode);
    expect(codesA).toEqual([`SB-0001-${YEAR}`, `SB-0001-${YEAR}`]);
    expect(codesB).toEqual([`SB-0002-${YEAR}`]);
  });

  it("rechaza un nombre repetido en el pool sin crear nada", async () => {
    await loginAs(world.users.jefe.email);
    await createStockBatch({ name: "Panel stock", elements: telaElements() });

    await expect(createStockBatch({ name: "panel STOCK", elements: telaElements() })).rejects.toThrow(
      /Ya existe una lámpara/,
    );
    expect(await prisma.lamp.count({ where: { projectId: poolId } })).toBe(1);
    expect(await prisma.task.count()).toBe(3);
  });

  it("rechaza tipología incoherente o el mismo tipo de elemento repetido", async () => {
    await loginAs(world.users.jefe.email);
    await expect(
      createStockBatch({
        name: "Mal",
        elements: [{ typology: ElementTypology.BASTIDOR, elementTypeId: world.tela.id, surfaceM2: 1, units: 1 }],
      }),
    ).rejects.toThrow(/tipología no coincide/);
    await expect(
      createStockBatch({ name: "Doble", elements: [...telaElements(), ...telaElements()] }),
    ).rejects.toThrow(/repetir el mismo tipo/);
    expect(await prisma.lamp.count()).toBe(0);
  });

  it("falla con un mensaje claro si no existe el pool de stock", async () => {
    await prisma.project.delete({ where: { id: poolId } });
    await loginAs(world.users.jefe.email);
    await expect(createStockBatch({ name: "X", elements: telaElements() })).rejects.toThrow(/STOCK-POOL/);
    expect(await prisma.lamp.count()).toBe(0);
  });

  it("un operario no puede crear lotes ni ver el stock", async () => {
    await loginAs(world.users.ana.email);
    await expect(createStockBatch({ name: "X", elements: telaElements() })).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(listStockLamps()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.lamp.count()).toBe(0);
  });
});

describe("devolver una lámpara a stock", () => {
  it("mueve lámpara y tareas al pool, libera sus OT (borrando las que quedan vacías) y recuerda el origen", async () => {
    const source = await createPlannableLamp(world);
    expect(Object.keys(source.workOrderIdByProcess)).toHaveLength(3);
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: source.lampId, reason: "  cliente canceló  " });

    const lamp = await expectTasksFollowLamp(source.lampId);
    expect(lamp.projectId).toBe(poolId);
    expect(lamp.previousProjectId).toBe(source.projectId);
    expect(lamp.returnedToStockReason).toBe("cliente canceló");
    expect(lamp.returnedToStockAt).toBeInstanceOf(Date);
    // En stock no se planifica: deja de estar aprobada (como los lotes y las unidades sueltas devueltas).
    expect(lamp.isApprovedForPlanning).toBe(false);
    expect(lamp.elements.map((e) => [e.stockStatus, e.stockBatchCode])).toEqual([
      [LampElementStockStatus.AVAILABLE, null],
    ]);
    // Ninguna tarea pendiente queda colgada de una OT, y las OT que solo tenían esta lámpara desaparecen.
    expect(lamp.tasks.every((t) => t.workOrderId === null && t.workOrderSequence === null)).toBe(true);
    expect(await prisma.workOrder.count()).toBe(0);
    // El proyecto origen se queda sin lámparas → vuelve a pendiente de aprobación.
    const project = await prisma.project.findUniqueOrThrow({ where: { id: source.projectId } });
    expect(project.approvalStatus).toBe(ProjectApprovalStatus.PENDING_APPROVAL);

    const [listed] = await listStockLamps();
    expect(listed!.id).toBe(source.lampId);
    expect(listed!.stockStatus).toBe(LampElementStockStatus.AVAILABLE);
    expect(listed!.previousProject?.id).toBe(source.projectId);
  });

  it("no borra una OT que sigue teniendo tareas de otra lámpara", async () => {
    const first = await createPlannableLamp(world, { name: "Hotel A" });
    // Segunda lámpara en otro proyecto; «Agrupar» la mete en OT nuevas (las existentes ya no se tocan).
    await loginAs(world.users.admin.email);
    const other = await newProject("Hotel B");
    const otherLamp = await createLamp({ projectId: other.id, name: "Otra", elements: telaElements() });
    const otherTasks = await prisma.task.findMany({ where: { lampId: otherLamp.id } });
    const cnc = otherTasks.find((t) => t.process === "CNC")!;
    // El admin añade desde «Órdenes de trabajo» la CNC de la otra lámpara a la OT de CNC de la primera.
    const wo = first.workOrderIdByProcess.CNC!;
    const current = await prisma.task.findMany({ where: { workOrderId: wo }, select: { id: true } });
    unwrap(await updateWorkOrder({ id: wo, taskIds: [...current.map((t) => t.id), cnc.id] }));
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: first.lampId });

    const sharedWo = await prisma.workOrder.findUnique({
      where: { id: first.workOrderIdByProcess.CNC! },
      include: { tasks: true },
    });
    expect(sharedWo?.status).toBe(WorkOrderStatus.OPEN);
    expect(sharedWo!.tasks.map((t) => t.id)).toEqual([cnc.id]);
    // Las OT exclusivas de la lámpara devuelta sí se eliminan.
    expect(await prisma.workOrder.findUnique({ where: { id: first.workOrderIdByProcess.PINTURA! } })).toBeNull();
  });

  it("exige confirmación si hay planning y, al confirmar, borra solo las asignaciones de esa lámpara", async () => {
    const source = await createPlannableLamp(world);
    const result = await generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });
    expect(result.assignmentsCount).toBeGreaterThan(0);
    const before = await prisma.planningAssignment.count();
    await loginAs(world.users.jefe.email);

    await expect(returnLampToStock({ lampId: source.lampId })).rejects.toThrow(/Confirma/);
    // Rechazo atómico: nada se ha movido.
    const untouched = await lampState(source.lampId);
    expect(untouched.projectId).toBe(source.projectId);
    expect(untouched.tasks.every((t) => t.workOrderId !== null)).toBe(true);
    expect(await prisma.planningAssignment.count()).toBe(before);
    expect(await prisma.workOrder.count()).toBe(3);

    await returnLampToStock({ lampId: source.lampId, confirmClearPlanning: true });
    expect(await prisma.planningAssignment.count({ where: { task: { lampId: source.lampId } } })).toBe(0);
    expect((await lampState(source.lampId)).projectId).toBe(poolId);
  });

  it("en una lámpara de varias unidades obliga a elegir y separa solo las unidades elegidas", async () => {
    const source = await createPlannableLamp(world, { units: 2 });
    const elements = await prisma.lampElement.findMany({ where: { lampId: source.lampId }, orderBy: { label: "asc" } });
    expect(elements).toHaveLength(2);
    const [keep, send] = elements as [(typeof elements)[0], (typeof elements)[0]];
    const totalTasks = await prisma.task.count();
    await loginAs(world.users.jefe.email);

    await expect(returnLampToStock({ lampId: source.lampId })).rejects.toThrow(/Selecciona al menos/);
    await expect(returnLampToStock({ lampId: source.lampId, lampElementIds: ["ajeno"] })).rejects.toThrow(
      /no pertenece al grupo/,
    );

    await returnLampToStock({ lampId: source.lampId, lampElementIds: [send.id], reason: "sobra" });

    // La original se queda con la unidad no elegida, intacta y en sus OT.
    const original = await expectTasksFollowLamp(source.lampId);
    expect(original.projectId).toBe(source.projectId);
    expect(original.units).toBe(1);
    expect(original.elements.map((e) => e.id)).toEqual([keep.id]);
    expect(original.tasks.every((t) => t.lampElementId === keep.id && t.workOrderId !== null)).toBe(true);

    // La unidad devuelta es una lámpara nueva en el pool, con sus propias tareas, sin OT.
    const stockLamp = await prisma.lamp.findFirstOrThrow({ where: { projectId: poolId } });
    const moved = await expectTasksFollowLamp(stockLamp.id);
    expect(moved.name).toBe("Lámpara A (stock ×1)");
    expect(moved.units).toBe(1);
    expect(moved.previousProjectId).toBe(source.projectId);
    expect(moved.returnedToStockReason).toBe("sobra");
    expect(moved.elements.map((e) => [e.id, e.stockStatus])).toEqual([[send.id, LampElementStockStatus.AVAILABLE]]);
    expect(moved.tasks.map((t) => t.process)).toEqual(["CNC", "ENSAMBLAJE", "PINTURA"]);
    expect(moved.tasks.every((t) => t.lampElementId === send.id && t.workOrderId === null)).toBe(true);

    // Conservación: no se crean ni pierden tareas ni unidades físicas.
    expect(await prisma.task.count()).toBe(totalTasks);
    expect(await prisma.lampElement.count()).toBe(2);
    // Las OT siguen vivas porque conservan las tareas de la unidad que se queda.
    expect(await prisma.workOrder.count()).toBe(3);
  });

  it("puede devolver al pool dos lámparas con el mismo nombre de proyectos distintos", async () => {
    const a = await createPlannableLamp(world, { name: "Hotel A" });
    const b = await createPlannableLamp(world, { name: "Hotel B" }); // ambas se llaman «Lámpara A»
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: a.lampId });
    await returnLampToStock({ lampId: b.lampId });

    const inPool = await prisma.lamp.findMany({ where: { projectId: poolId }, orderBy: { name: "asc" } });
    expect(inPool.map((l) => [l.id, l.name])).toEqual([
      [a.lampId, "Lámpara A"],
      [b.lampId, "Lámpara A (2)"],
    ]);
    for (const l of inPool) await expectTasksFollowLamp(l.id);
  });

  it("puede devolver en dos veces las unidades de una misma lámpara", async () => {
    const source = await createPlannableLamp(world, { units: 3 });
    const elements = await prisma.lampElement.findMany({ where: { lampId: source.lampId }, orderBy: { label: "asc" } });
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: source.lampId, lampElementIds: [elements[0]!.id] });
    await returnLampToStock({ lampId: source.lampId, lampElementIds: [elements[1]!.id] });

    const inPool = await prisma.lamp.findMany({ where: { projectId: poolId }, include: { elements: true } });
    expect(inPool.map((l) => l.name).sort()).toEqual(["Lámpara A (stock ×1)", "Lámpara A (stock ×1) (2)"]);
    expect(inPool.flatMap((l) => l.elements.map((e) => e.id)).sort()).toEqual(
      [elements[0]!.id, elements[1]!.id].sort(),
    );
    expect((await lampState(source.lampId)).units).toBe(1);
  });

  it("no se puede devolver algo que ya está en el pool, y un operario no puede devolver nada", async () => {
    const source = await createPlannableLamp(world);
    await loginAs(world.users.ana.email);
    await expect(returnLampToStock({ lampId: source.lampId })).rejects.toThrow(/NEXT_REDIRECT/);
    expect((await lampState(source.lampId)).projectId).toBe(source.projectId);

    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: source.lampId });
    await expect(returnLampToStock({ lampId: source.lampId })).rejects.toThrow(/ya está en el pool/);
  });
});

describe("asignar una lámpara de stock a un proyecto", () => {
  async function returnedLamp() {
    const source = await createPlannableLamp(world, { name: "Hotel Origen" });
    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: source.lampId });
    return source;
  }

  it("la mueve con sus tareas al proyecto destino, la marca asignada y limpia el rastro de devolución", async () => {
    const source = await returnedLamp();
    const target = await newProject("Hotel Destino");

    const result = await assignLampFromStockToProject({
      lampId: source.lampId,
      targetProjectId: target.id,
      newName: "  Lámpara Hall  ",
    });
    expect(result).toEqual({ id: source.lampId, projectId: target.id });

    const lamp = await expectTasksFollowLamp(source.lampId);
    expect(lamp.projectId).toBe(target.id);
    expect(lamp.name).toBe("Lámpara Hall");
    expect(lamp.previousProjectId).toBeNull();
    expect(lamp.returnedToStockAt).toBeNull();
    expect(lamp.returnedToStockReason).toBeNull();
    expect(lamp.elements.every((e) => e.stockStatus === LampElementStockStatus.ASSIGNED)).toBe(true);
    // Ya no aparece en el stock.
    expect(await listStockLamps()).toEqual([]);
    // Llega sin aprobar: el admin decide cuándo entra en el planning del proyecto destino.
    expect(lamp.isApprovedForPlanning).toBe(false);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: target.id } });
    expect(project.approvalStatus).toBe(ProjectApprovalStatus.PENDING_APPROVAL);
  });

  it("una lámpara aprobada que pasa por stock llega sin aprobar al proyecto destino", async () => {
    const source = await createPlannableLamp(world, { name: "Hotel Origen" });
    expect((await lampState(source.lampId)).isApprovedForPlanning).toBe(true);
    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: source.lampId });
    const target = await newProject("Hotel Destino");

    await assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: target.id });

    expect((await lampState(source.lampId)).isApprovedForPlanning).toBe(false);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: target.id } });
    expect(project.approvalStatus).toBe(ProjectApprovalStatus.PENDING_APPROVAL);
  });

  it("engancha cada tarea a la OT abierta de su mismo grupo (tipo + proceso) en el destino", async () => {
    // Destino primero: sus OT (una por proceso) ya existen cuando la otra lámpara se agrupa.
    const target = await createPlannableLamp(world, { name: "Hotel Destino" });
    const source = await createPlannableLamp(world, { name: "Hotel Origen" });
    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: source.lampId });

    await assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: target.projectId, newName: "Otra" });

    // El destino estaba en producción; la lámpara recibida (sin aprobar) lo deja en aprobación parcial.
    const project = await prisma.project.findUniqueOrThrow({ where: { id: target.projectId } });
    expect(project.approvalStatus).toBe(ProjectApprovalStatus.PARTIAL_APPROVAL);
    const tasks = await prisma.task.findMany({ where: { lampId: source.lampId }, include: { workOrder: true } });
    expect(tasks).toHaveLength(3);
    for (const t of tasks) {
      expect(t.workOrderId, t.process).toBe(target.workOrderIdByProcess[t.process]);
      expect(t.workOrder!.status).toBe(WorkOrderStatus.OPEN);
    }
    // Ninguna OT mezcla procesos.
    for (const wo of await prisma.workOrder.findMany({ include: { tasks: true } })) {
      expect(new Set(wo.tasks.map((t) => t.process)).size, wo.number).toBe(1);
    }
    // Secuencia de la OT sin huecos ni repetidos.
    const cncSeq = await prisma.task.findMany({
      where: { workOrderId: target.workOrderIdByProcess.CNC! },
      orderBy: { workOrderSequence: "asc" },
    });
    expect(cncSeq.map((t) => t.workOrderSequence)).toEqual([0, 1]);

    // Ciclo completo: el admin la aprueba en el destino y el planning la incluye sin pedir OT nuevas.
    await loginAs(world.users.admin.email);
    await setLampApprovedForPlanning({ lampId: source.lampId, isApprovedForPlanning: true });
    const result = await generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });
    expect(result.unscheduledHours).toBe(0);
    const plannedTaskIds = new Set((await prisma.planningAssignment.findMany()).map((a) => a.taskId));
    for (const t of tasks) expect(plannedTaskIds.has(t.id), t.process).toBe(true);
  });

  it("si el destino no tiene OT abierta de su grupo, la tarea queda sin OT (no se mete en otra de otro proceso)", async () => {
    const target = await createPlannableLamp(world, { name: "Hotel Destino" });
    const source = await createPlannableLamp(world, { name: "Hotel Origen" });
    // El admin borra la OT de pintura del destino: solo quedan las de CNC y ensamblaje.
    unwrap(await deleteWorkOrder({ id: target.workOrderIdByProcess.PINTURA! }));
    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: source.lampId });

    await assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: target.projectId, newName: "Otra" });

    const tasks = await prisma.task.findMany({ where: { lampId: source.lampId } });
    const byProcess = Object.fromEntries(tasks.map((t) => [t.process, t.workOrderId]));
    expect(byProcess).toEqual({
      CNC: target.workOrderIdByProcess.CNC,
      ENSAMBLAJE: target.workOrderIdByProcess.ENSAMBLAJE,
      PINTURA: null,
    });
    // «Agrupar» le crea después su propia OT de pintura, sin mezclar procesos.
    await loginAs(world.users.admin.email);
    unwrap(await autoGroupIdenticalTasks());
    const painting = await prisma.task.findFirstOrThrow({
      where: { lampId: source.lampId, process: "PINTURA" },
      include: { workOrder: { include: { tasks: true } } },
    });
    expect(painting.workOrder?.tasks.every((t) => t.process === "PINTURA")).toBe(true);
  });

  it("rechaza destinos no válidos y nombres repetidos sin tocar la lámpara", async () => {
    const source = await returnedLamp();
    const target = await createPlannableLamp(world, { name: "Hotel Destino" }); // ya tiene «Lámpara A»
    await loginAs(world.users.jefe.email);
    const inactive = await newProject("Cerrado");
    await toggleProjectActive({ projectId: inactive.id, isActive: false });

    await expect(
      assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: target.projectId }),
    ).rejects.toThrow(/Ya existe una lámpara/);
    await expect(
      assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: inactive.id }),
    ).rejects.toThrow(/Proyecto destino no encontrado/);
    await expect(assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: poolId })).rejects.toThrow(
      /pool interno/,
    );

    const lamp = await lampState(source.lampId);
    expect(lamp.projectId).toBe(poolId);
    expect(lamp.elements.every((e) => e.stockStatus === LampElementStockStatus.AVAILABLE)).toBe(true);
    expect(lamp.tasks.every((t) => t.projectId === poolId)).toBe(true);
  });

  it("no asigna lámparas que no están en el pool ni la misma lámpara dos veces", async () => {
    const inProject = await createPlannableLamp(world, { name: "Hotel X" });
    await loginAs(world.users.jefe.email);
    const target = await newProject("Hotel Destino");
    await expect(
      assignLampFromStockToProject({ lampId: inProject.lampId, targetProjectId: target.id }),
    ).rejects.toThrow(/no pertenece al pool/);

    const { id } = await createStockBatch({ name: "Lote", elements: telaElements() });
    await assignLampFromStockToProject({ lampId: id, targetProjectId: target.id });
    await expect(assignLampFromStockToProject({ lampId: id, targetProjectId: target.id })).rejects.toThrow(
      /no pertenece al pool/,
    );
  });

  it("un operario no puede asignar stock", async () => {
    await loginAs(world.users.jefe.email);
    const { id } = await createStockBatch({ name: "Lote", elements: telaElements() });
    const target = await newProject("Hotel Destino");
    await loginAs(world.users.ana.email);
    await expect(assignLampFromStockToProject({ lampId: id, targetProjectId: target.id })).rejects.toThrow(
      /NEXT_REDIRECT/,
    );
    expect((await lampState(id)).projectId).toBe(poolId);
  });
});

describe("eliminar una lámpara de stock", () => {
  it("borra lámpara, unidades y tareas, y las OT que solo tenían esas tareas", async () => {
    await loginAs(world.users.admin.email);
    const { id } = await createStockBatch({ name: "Lote", elements: telaElements(2) });
    // Las tareas del pool también se agrupan en OT (el pool es un proyecto activo).
    unwrap(await autoGroupIdenticalTasks());
    expect(await prisma.workOrder.count()).toBe(3);

    await deleteStockLamp({ lampId: id });

    expect(await prisma.lamp.count({ where: { id } })).toBe(0);
    expect(await prisma.lampElement.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.workOrder.count()).toBe(0);
  });

  it("no deja borrar si hay horas fichadas en sus tareas", async () => {
    await loginAs(world.users.admin.email);
    const { id } = await createStockBatch({ name: "Lote", elements: telaElements() });
    unwrap(await autoGroupIdenticalTasks());
    const cnc = await prisma.task.findFirstOrThrow({ where: { lampId: id, process: "CNC" } });

    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: poolId,
        lampId: id,
        taskId: cnc.id,
        process: "CNC",
        startedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(),
        hours: 1,
      }),
    );

    await loginAs(world.users.jefe.email);
    const [listed] = await listStockLamps();
    expect(listed!.canHardDelete).toBe(false);
    await expect(deleteStockLamp({ lampId: id })).rejects.toThrow(/horas registradas/);
    expect(await prisma.task.count({ where: { lampId: id } })).toBe(3);
    expect(await prisma.timeEntry.count()).toBe(1);
  });

  it("solo borra lámparas del pool", async () => {
    const inProject = await createPlannableLamp(world);
    await loginAs(world.users.jefe.email);
    await expect(deleteStockLamp({ lampId: inProject.lampId })).rejects.toThrow(/no pertenece al pool/);
    expect(await prisma.lamp.count({ where: { id: inProject.lampId } })).toBe(1);

    const { id } = await createStockBatch({ name: "Lote", elements: telaElements() });
    await loginAs(world.users.ana.email);
    await expect(deleteStockLamp({ lampId: id })).rejects.toThrow(/NEXT_REDIRECT/);
    expect(await prisma.lamp.count({ where: { id } })).toBe(1);
  });
});

describe("stock y planning", () => {
  it("una lámpara devuelta a stock deja de planificarse y no bloquea el planning de la nave", async () => {
    const kept = await createPlannableLamp(world, { name: "Hotel A" });
    const returned = await createPlannableLamp(world, { name: "Hotel B" });
    await loginAs(world.users.jefe.email);
    await returnLampToStock({ lampId: returned.lampId, confirmClearPlanning: true });

    const result = await generatePlanning({ naveId: world.naves.n1.id, weekStart: WEEK, planFrom: "WEEK_START" });

    expect(result.unscheduledHours).toBe(0);
    const planned = await prisma.planningAssignment.findMany({ include: { task: true } });
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((a) => a.task.lampId === kept.lampId)).toBe(true);
  });
});

describe("los fichajes siguen a sus tareas al mover lámparas", () => {
  async function logHours(task: { id: string; projectId: string; lampId: string; process: string }, daysAgo: number) {
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: task.projectId,
        lampId: task.lampId,
        taskId: task.id,
        process: task.process,
        startedAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
        hours: 1,
      }),
    );
  }

  /** Invariante: cada fichaje con tarea apunta al proyecto y la lámpara actuales de esa tarea. */
  async function expectEntriesMatchTasks() {
    const entries = await prisma.timeEntry.findMany({ include: { task: true } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e.projectId).toBe(e.task!.projectId);
      expect(e.lampId).toBe(e.task!.lampId);
    }
    return entries;
  }

  it("al devolver a stock y asignar a otro proyecto, las horas viajan con la lámpara", async () => {
    const source = await createPlannableLamp(world, { name: "Hotel Origen" });
    await logHours(source.tasks.find((t) => t.process === "CNC")!, 2);
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: source.lampId });
    const [inStock] = await expectEntriesMatchTasks();
    expect(inStock!.projectId).toBe(poolId);

    const target = await newProject("Hotel Destino");
    await assignLampFromStockToProject({ lampId: source.lampId, targetProjectId: target.id });
    const [assigned] = await expectEntriesMatchTasks();
    expect(assigned!.projectId).toBe(target.id);
    expect(await prisma.timeEntry.count({ where: { projectId: source.projectId } })).toBe(0);
  });

  it("en una devolución parcial solo se mueven los fichajes de las unidades devueltas", async () => {
    const source = await createPlannableLamp(world, { units: 2 });
    const elements = await prisma.lampElement.findMany({ where: { lampId: source.lampId }, orderBy: { label: "asc" } });
    const cncOf = (elementId: string) =>
      source.tasks.find((t) => t.lampElementId === elementId && t.process === "CNC")!;
    await logHours(cncOf(elements[0]!.id), 2);
    await logHours(cncOf(elements[1]!.id), 3);
    await loginAs(world.users.jefe.email);

    await returnLampToStock({ lampId: source.lampId, lampElementIds: [elements[1]!.id] });

    const entries = await expectEntriesMatchTasks();
    const kept = entries.find((e) => e.taskId === cncOf(elements[0]!.id).id)!;
    const moved = entries.find((e) => e.taskId === cncOf(elements[1]!.id).id)!;
    expect([kept.projectId, kept.lampId]).toEqual([source.projectId, source.lampId]);
    expect(moved.projectId).toBe(poolId);
    expect(moved.lampId).not.toBe(source.lampId);
  });
});
