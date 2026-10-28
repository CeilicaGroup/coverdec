import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { ElementTypology, ProjectApprovalStatus, ProjectKind, TimeEntrySource } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  applyImportPreview as applyImportPreviewAction,
  buildImportPreview as buildImportPreviewAction,
  inspectImportFile,
} from "@/features/imports/actions";
import type {
  BastidorRowDraft,
  HorasRowDraft,
  ImportKind,
  ImportMapping,
  ProyectoRowDraft,
} from "@/features/imports/types";
import { updateTypologyDefaultNave } from "@/features/catalog/actions";
import { createLamp, createProject } from "@/features/projects/actions";
import { createManualEntry } from "@/features/time-tracking/actions";
import { buildWorld, expectFail, loginAs, unwrap, type World } from "@/test/integration/world";

let world: World;

beforeEach(async () => {
  world = await buildWorld();
  await loginAs(world.users.admin.email);
});

// ---------------------------------------------------------------------------
// Excel de prueba: mismo formato que PRODUCCION.xlsx (hojas y columnas del preset legacy),
// generado con exceljs, la misma librería que usa el parser.
// ---------------------------------------------------------------------------

type Cell = string | number | Date | null;
/** Fila como mapa columna(1-based) → valor. */
type SheetRow = Record<number, Cell>;

const BBDD = "BBDD";
const PROYECTOS = "🗂️ Proyectos";
const HORAS = "👷horas";

/** BBDD: col 7 tipo bastidor, col 9 proceso, col 10 horas/m². */
const bbdd = (frame: Cell, process: Cell, hours: Cell): SheetRow => ({ 7: frame, 9: process, 10: hours });

interface ProyectoLine {
  project: string;
  lamp: string;
  frame: string;
  m2?: number;
  delivery?: Date;
  area?: string;
  process: string;
  hrPlan: Cell;
  taskStatus?: string;
  projectStatus?: string;
}
/** Proyectos: 1 proyecto, 2 lámpara, 3 tipo, 4 m², 5 entrega, 6 área, 7 proceso, 8 Hr_plan, 16-17 estados. */
const proyecto = (l: ProyectoLine): SheetRow => ({
  1: l.project,
  2: l.lamp,
  3: l.frame,
  4: l.m2 ?? null,
  5: l.delivery ?? null,
  6: l.area ?? null,
  7: l.process,
  8: l.hrPlan,
  16: l.taskStatus ?? null,
  17: l.projectStatus ?? null,
});

interface HorasLine {
  date: Date;
  operator: string;
  project: string;
  lamp: string;
  process: string;
  normal: number | null;
  extra?: number;
  start?: string;
  end?: string;
  notes?: string;
}
/** Horas: 2 fecha, 3 operario, 4 proyecto, 5 lámpara, 7 proceso, 8-9 inicio/fin, 10-11 horas, 12 notas. */
const horas = (l: HorasLine): SheetRow => ({
  2: l.date,
  3: l.operator,
  4: l.project,
  5: l.lamp,
  7: l.process,
  8: l.start ?? null,
  9: l.end ?? null,
  10: l.normal,
  11: l.extra ?? null,
  12: l.notes ?? null,
});

async function excelFile(sheets: Record<string, SheetRow[]>, name = "PRODUCCION.xlsx"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(sheetName);
    ws.getRow(1).getCell(1).value = "cabecera";
    rows.forEach((row, i) => {
      for (const [col, value] of Object.entries(row)) {
        if (value != null) ws.getRow(i + 2).getCell(Number(col)).value = value;
      }
    });
  }
  const buffer = await wb.xlsx.writeBuffer();
  return new File([buffer as ArrayBuffer], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function uploadForm(file: File, kind: ImportKind) {
  const fd = new FormData();
  fd.set("file", file);
  fd.set("importKind", kind);
  return fd;
}

// Las actions devuelven ActionResult (el mensaje llega a la UI también en producción).
// En el camino feliz se desenvuelven; los casos de error usan las actions tal cual.
async function inspect(file: File, kind: ImportKind) {
  return unwrap(await inspectImportFile(uploadForm(file, kind)));
}
async function buildImportPreview(input: Parameters<typeof buildImportPreviewAction>[0]) {
  return unwrap(await buildImportPreviewAction(input));
}
async function applyImportPreview(input: Parameters<typeof applyImportPreviewAction>[0]) {
  return unwrap(await applyImportPreviewAction(input));
}

/** Paso 1-2 del asistente: subir el Excel y generar la vista previa con el mapeo sugerido. */
async function uploadAndPreview<T>(
  sheets: Record<string, SheetRow[]>,
  kind: Exclude<ImportKind, "produccion_completa">,
  rowEdits?: Array<{ rowIndex: number; patch: Record<string, unknown> }>,
) {
  const inspected = await inspect(await excelFile(sheets), kind);
  const preview = await buildImportPreview({
    sessionId: inspected.sessionId,
    importKind: kind,
    mapping: inspected.suggestedMapping,
    rowEdits,
  });
  return {
    inspected,
    sessionId: inspected.sessionId,
    mapping: inspected.suggestedMapping as ImportMapping,
    rows: preview.rows as T[],
    summary: preview.summary,
  };
}

/** Flujo completo del asistente: subir → vista previa (con correcciones) → confirmar. */
async function importSheets(
  sheets: Record<string, SheetRow[]>,
  kind: Exclude<ImportKind, "produccion_completa">,
  rowEdits?: Array<{ rowIndex: number; patch: Record<string, unknown> }>,
) {
  const { sessionId, rows } = await uploadAndPreview<BastidorRowDraft>(sheets, kind, rowEdits);
  return applyImportPreview({ sessionId, importKind: kind, rows });
}

/** Fila del Excel (rowIndex) → fila i de datos (la 1 es la cabecera). */
const excelRow = (i: number) => i + 2;
const byRow = <T extends { rowIndex: number }>(rows: T[], i: number) => rows.find((r) => r.rowIndex === excelRow(i))!;

async function catalogSnapshot() {
  return prisma.elementType.findMany({
    orderBy: { code: "asc" },
    select: {
      code: true,
      name: true,
      processes: { orderBy: { sequence: "asc" }, select: { process: true, sequence: true, hoursPerUnit: true } },
    },
  });
}

async function processesOf(code: string) {
  return prisma.elementTypeProcess.findMany({
    where: { elementType: { code } },
    orderBy: { sequence: "asc" },
    select: { process: true, sequence: true, hoursPerUnit: true },
  });
}

// ---------------------------------------------------------------------------

describe("importar bastidores (catálogo desde la hoja BBDD)", () => {
  it("crea tipos de elemento con procesos y horas/m² en el orden del Excel y da de alta solo los procesos que faltan", async () => {
    const sheets = {
      [BBDD]: [
        bbdd("Pantalla Oval", "CNC", 0.5),
        bbdd("Pantalla Oval", "Lijado y masillado", 0.25),
        bbdd("Pantalla Oval", "Pintura", 0.4),
        bbdd("Aro Grande", "cnc", 1.2),
        bbdd("Aro Grande", "Ensamblaje", 2),
      ],
    };
    const { inspected, rows, summary, sessionId } = await uploadAndPreview<BastidorRowDraft>(sheets, "bastidores");
    expect(inspected.importKind).toBe("bastidores");
    expect(inspected.availableKinds).toEqual(["bastidores"]);
    expect(inspected.sampleRowCount).toBe(5);
    expect(summary).toMatchObject({ total: 5, ok: 5, error: 0, willCreate: 5, willUpdate: 0 });

    const result = await applyImportPreview({ sessionId, importKind: "bastidores", rows });
    expect(result.bastidores).toEqual({ created: 2, updated: 0, skipped: 0, processesCreated: 1 });

    expect(await processesOf("pantalla-oval")).toEqual([
      { process: "CNC", sequence: 0, hoursPerUnit: 0.5 },
      { process: "LIJADO", sequence: 1, hoursPerUnit: 0.25 },
      { process: "PINTURA", sequence: 2, hoursPerUnit: 0.4 },
    ]);
    expect(await processesOf("aro-grande")).toEqual([
      { process: "CNC", sequence: 0, hoursPerUnit: 1.2 },
      { process: "ENSAMBLAJE", sequence: 1, hoursPerUnit: 2 },
    ]);
    expect((await prisma.elementType.findUniqueOrThrow({ where: { code: "pantalla-oval" } })).name).toBe(
      "Pantalla Oval",
    );

    // El alias legacy se resuelve a LIJADO y se crea; los procesos existentes no se tocan.
    const lijado = await prisma.processDefinition.findUniqueOrThrow({ where: { code: "LIJADO" } });
    expect(lijado.label).toBe("Lijado y masillado");
    expect((await prisma.processDefinition.findUniqueOrThrow({ where: { code: "PINTURA" } })).label).toBe("Pintura");
    expect(await prisma.processDefinition.count()).toBe(7); // 6 del mundo + LIJADO
    // El TELA de catálogo previo sigue intacto.
    expect(await processesOf("TELA")).toHaveLength(3);
  });

  it("las filas inválidas salen marcadas con un mensaje que dice qué falta y no se importan", async () => {
    const sheets = {
      [BBDD]: [
        bbdd("Pantalla Oval", "CNC", 0.5), // válida
        bbdd("Sin horas", "CNC", null),
        bbdd("Horas negativas", "CNC", -1),
        bbdd("Sin proceso", null, 1),
        bbdd(null, "CNC", 1),
        bbdd("Proceso ilegible", "???", 1),
        bbdd("Horas en texto", "CNC", "mucho"),
      ],
    };
    const { rows, summary, sessionId } = await uploadAndPreview<BastidorRowDraft>(sheets, "bastidores");

    const issueOf = (i: number) => byRow(rows, i).issues.map((x) => x.message).join(" | ");
    expect(byRow(rows, 0).status).toBe("ok");
    expect(issueOf(1)).toMatch(/Faltan las horas por unidad/);
    expect(issueOf(2)).toMatch(/Las horas deben ser >= 0/);
    expect(issueOf(3)).toMatch(/Falta el proceso/);
    expect(issueOf(4)).toMatch(/Falta el nombre del bastidor/);
    expect(issueOf(5)).toMatch(/No se pudo derivar un código de proceso válido: "\?\?\?"/);
    expect(issueOf(6)).toMatch(/Faltan las horas por unidad/);
    for (const i of [1, 2, 3, 4, 5, 6]) {
      expect(byRow(rows, i), `fila ${excelRow(i)}`).toMatchObject({ status: "error", action: "skip" });
    }
    expect(summary).toMatchObject({ total: 7, ok: 1, error: 6, willCreate: 1, willSkip: 6 });

    const result = await applyImportPreview({ sessionId, importKind: "bastidores", rows });
    expect(result.bastidores).toMatchObject({ created: 1, skipped: 6 });
    expect((await catalogSnapshot()).map((e) => e.code).sort()).toEqual(["TELA", "pantalla-oval"].sort());
    // Las filas con error tampoco dan de alta procesos nuevos (p. ej. "???").
    expect(await prisma.processDefinition.count()).toBe(6);
  });

  it("no deja confirmar si una fila con error se fuerza a importar, y no escribe nada", async () => {
    const before = await catalogSnapshot();
    const { rows, sessionId } = await uploadAndPreview<BastidorRowDraft>(
      { [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5), bbdd("Sin horas", "CNC", null)] },
      "bastidores",
    );
    const forced = rows.map((r) => (r.status === "error" ? { ...r, action: "create" as const } : r));

    expect(expectFail(await applyImportPreviewAction({ sessionId, importKind: "bastidores", rows: forced }))).toBe(
      "Hay 1 fila(s) con error sin marcar como «Omitir». Corrígelas o omítelas antes de importar.",
    );
    expect(await catalogSnapshot()).toEqual(before);
  });

  it("reimportar el mismo Excel no duplica nada; con horas cambiadas actualiza las horas del catálogo", async () => {
    const v1 = {
      [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5), bbdd("Pantalla Oval", "Pintura", 0.4), bbdd("Aro Grande", "CNC", 1)],
    };
    await importSheets(v1, "bastidores");
    const afterFirst = await catalogSnapshot();
    const processCount = await prisma.processDefinition.count();

    // Mismo fichero otra vez: todo se detecta como actualización y el catálogo queda idéntico.
    const again = await uploadAndPreview<BastidorRowDraft>(v1, "bastidores");
    expect(again.rows.map((r) => r.action)).toEqual(["update", "update", "update"]);
    const second = await applyImportPreview({ sessionId: again.sessionId, importKind: "bastidores", rows: again.rows });
    expect(second.bastidores).toEqual({ created: 0, updated: 2, skipped: 0, processesCreated: 0 });
    expect(await catalogSnapshot()).toEqual(afterFirst);
    expect(await prisma.processDefinition.count()).toBe(processCount);

    // Nueva versión con horas corregidas: se actualizan en sitio, sin filas nuevas.
    const v2 = {
      [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.7), bbdd("Pantalla Oval", "Pintura", 0.4), bbdd("Aro Grande", "CNC", 1.5)],
    };
    await importSheets(v2, "bastidores");
    expect(await processesOf("pantalla-oval")).toEqual([
      { process: "CNC", sequence: 0, hoursPerUnit: 0.7 },
      { process: "PINTURA", sequence: 1, hoursPerUnit: 0.4 },
    ]);
    expect(await processesOf("aro-grande")).toEqual([{ process: "CNC", sequence: 0, hoursPerUnit: 1.5 }]);
    expect(await prisma.elementType.count()).toBe(3);
    expect(await prisma.elementTypeProcess.count()).toBe(3 + 3); // TELA + importados
  });

  it("marcar «Omitir» una fila válida en la revisión la deja fuera de la importación", async () => {
    const sheets = { [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5), bbdd("Aro Grande", "CNC", 1)] };
    const { rows, sessionId } = await uploadAndPreview<BastidorRowDraft>(sheets, "bastidores", [
      { rowIndex: excelRow(1), patch: { action: "skip" } },
    ]);
    expect(byRow(rows, 1).action).toBe("skip");

    const result = await applyImportPreview({ sessionId, importKind: "bastidores", rows });
    expect(result.bastidores).toMatchObject({ created: 1, skipped: 1 });
    expect(await prisma.elementType.findUnique({ where: { code: "aro-grande" } })).toBeNull();
  });

  it("corregir una fila en la revisión la hace importable, pero unas horas negativas siguen bloqueadas", async () => {
    const sheets = { [BBDD]: [bbdd("Pantalla Oval", "CNC", null), bbdd("Aro Grande", "CNC", null)] };
    const { rows, sessionId } = await uploadAndPreview<BastidorRowDraft>(sheets, "bastidores", [
      { rowIndex: excelRow(0), patch: { hoursPerUnit: 0.75 } },
      { rowIndex: excelRow(1), patch: { hoursPerUnit: -2 } },
    ]);
    expect(byRow(rows, 0)).toMatchObject({ status: "ok", action: "create", hoursPerUnit: 0.75 });
    expect(byRow(rows, 1)).toMatchObject({ status: "error", action: "skip" });
    expect(byRow(rows, 1).issues.map((i) => i.message)).toContain("Las horas deben ser >= 0");

    await applyImportPreview({ sessionId, importKind: "bastidores", rows });
    expect(await processesOf("pantalla-oval")).toEqual([{ process: "CNC", sequence: 0, hoursPerUnit: 0.75 }]);
    expect(await prisma.elementType.findUnique({ where: { code: "aro-grande" } })).toBeNull();
  });

  it("es transaccional: si una escritura falla a mitad, no queda ni el primer bastidor ni los procesos creados", async () => {
    const before = await catalogSnapshot();
    const processCount = await prisma.processDefinition.count();
    const { rows, sessionId } = await uploadAndPreview<BastidorRowDraft>(
      { [BBDD]: [bbdd("Pantalla Oval", "Lijado", 0.5), bbdd("Aro Grande", "CNC", 1)] },
      "bastidores",
    );
    // Postgres rechaza el carácter NUL en texto: simula un fallo de BD en el segundo bastidor,
    // cuando el proceso LIJADO y el primer bastidor ya se han escrito dentro de la transacción.
    const poisoned = rows.map((r, i) => (i === 1 ? { ...r, frameName: "Aro\u0000Grande" } : r));

    expectFail(await applyImportPreviewAction({ sessionId, importKind: "bastidores", rows: poisoned }));
    expect(await catalogSnapshot()).toEqual(before);
    expect(await prisma.processDefinition.count()).toBe(processCount);
  });

  it("los cambios de horas importados no recalculan lámparas ya creadas; las lámparas nuevas usan las horas nuevas", async () => {
    await importSheets({ [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5), bbdd("Pantalla Oval", "Pintura", 1)] }, "bastidores");
    const oval = await prisma.elementType.findUniqueOrThrow({ where: { code: "pantalla-oval" } });
    // El bastidor importado es usable para dar de alta lámparas (tipología por defecto BASTIDOR).
    expect(oval.typology).toBe(ElementTypology.BASTIDOR);

    const project = await createProject({ name: "Hotel Import", kind: ProjectKind.PRODUCCION, isBillable: true });
    const elements = [{ typology: ElementTypology.BASTIDOR, elementTypeId: oval.id, surfaceM2: 2, units: 1 }];
    const oldLamp = await createLamp({ projectId: project.id, name: "Vieja", elements });
    const hoursOf = async (lampId: string) =>
      (await prisma.task.findMany({ where: { lampId }, orderBy: { order: "asc" } })).map((t) => [
        t.process,
        t.estimatedHours,
      ]);
    expect(await hoursOf(oldLamp.id)).toEqual([["CNC", 1], ["PINTURA", 2]]);

    await importSheets({ [BBDD]: [bbdd("Pantalla Oval", "CNC", 1.5), bbdd("Pantalla Oval", "Pintura", 1)] }, "bastidores");

    expect(await hoursOf(oldLamp.id)).toEqual([["CNC", 1], ["PINTURA", 2]]);
    const newLamp = await createLamp({ projectId: project.id, name: "Nueva", elements });
    expect(await hoursOf(newLamp.id)).toEqual([["CNC", 3], ["PINTURA", 2]]);
  });
});

// ---------------------------------------------------------------------------

describe("importar proyectos (hoja Proyectos)", () => {
  const delivery = new Date(Date.UTC(2026, 11, 15));

  it("crea proyectos, lámparas y tareas históricas completadas contra el catálogo, y archiva los proyectos terminados", async () => {
    // La tipología TELA se fabrica en N2: las tareas importadas deben ir a N2, no a la nave de reserva.
    unwrap(await updateTypologyDefaultNave({ typology: ElementTypology.TELA, defaultNaveId: world.naves.n2.id }));
    const sheets = {
      [PROYECTOS]: [
        proyecto({ project: "Hotel Ritz", lamp: "Lámpara 1", frame: "Panel de tela", m2: 2.5, delivery, area: "Hall", process: "CNC", hrPlan: 3, taskStatus: "Terminado" }),
        proyecto({ project: "Hotel Ritz", lamp: "Lámpara 1", frame: "panel de TELA", m2: 2.5, delivery, process: "Ensamblaje", hrPlan: 4 }),
        proyecto({ project: "Casa Pepe", lamp: "Aplique", frame: "TELA", process: "Pintura", hrPlan: 1.5, projectStatus: "Terminado" }),
      ],
    };
    const { rows, summary, sessionId, inspected } = await uploadAndPreview<ProyectoRowDraft>(sheets, "proyectos");
    expect(inspected.importKind).toBe("proyectos");
    expect(summary).toMatchObject({ total: 3, error: 0, willCreate: 3 });
    expect(rows.every((r) => r.elementTypeId === world.tela.id)).toBe(true);

    const result = await applyImportPreview({ sessionId, importKind: "proyectos", rows });
    expect(result.proyectos).toMatchObject({ lampsCreated: 2, tasksCreated: 3, skipped: 0, projectsArchived: 1 });

    const ritz = await prisma.project.findUniqueOrThrow({
      where: { code: "hotel-ritz" },
      include: { lamps: { include: { elements: true, tasks: { orderBy: { order: "asc" } } } } },
    });
    expect(ritz).toMatchObject({ name: "Hotel Ritz", isActive: true, deliveryDate: delivery });
    expect(ritz.approvalStatus).toBe(ProjectApprovalStatus.PENDING_APPROVAL);
    expect(ritz.lamps).toHaveLength(1);
    const lamp = ritz.lamps[0]!;
    expect(lamp.name).toBe("Lámpara 1");
    expect(lamp.elements).toHaveLength(1);
    expect(lamp.elements[0]).toMatchObject({ elementTypeId: world.tela.id, surfaceM2: 2.5 });
    expect(lamp.tasks.map((t) => [t.process, t.estimatedHours, t.isCompleted, t.naveId])).toEqual([
      ["CNC", 3, true, world.naves.n2.id],
      ["ENSAMBLAJE", 4, true, world.naves.n2.id],
    ]);
    expect(lamp.tasks.every((t) => t.lampElementId === lamp.elements[0]!.id)).toBe(true);

    const pepe = await prisma.project.findUniqueOrThrow({ where: { code: "casa-pepe" } });
    expect(pepe.isActive).toBe(false);
  });

  it("rechaza filas con tipo de bastidor desconocido o sin horas plan, diciendo cuál, y no crea nada de ellas", async () => {
    const sheets = {
      [PROYECTOS]: [
        proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "Bastidor fantasma", process: "CNC", hrPlan: 3 }),
        proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: null }),
        proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: -1 }),
      ],
    };
    const { rows, sessionId } = await uploadAndPreview<ProyectoRowDraft>(sheets, "proyectos");
    expect(rows.map((r) => [r.status, r.action])).toEqual([
      ["error", "skip"],
      ["error", "skip"],
      ["error", "skip"],
    ]);
    expect(byRow(rows, 0).issues.map((i) => i.message)).toContain(
      'Tipo de bastidor no encontrado en catálogo: "Bastidor fantasma"',
    );
    expect(byRow(rows, 1).issues.map((i) => i.message)).toContain("Faltan las horas planificadas (Hr_plan)");
    expect(byRow(rows, 2).issues.map((i) => i.message)).toContain("Hr_plan debe ser >= 0");

    const result = await applyImportPreview({ sessionId, importKind: "proyectos", rows });
    expect(result.proyectos).toMatchObject({ projectsCreated: 0, tasksCreated: 0, skipped: 3 });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });

  it("reimportar no duplica proyectos, lámparas ni tareas: actualiza las horas plan", async () => {
    const line = { project: "Hotel Ritz", lamp: "Lámpara 1", frame: "TELA", m2: 2 };
    const v1 = { [PROYECTOS]: [proyecto({ ...line, process: "CNC", hrPlan: 3 }), proyecto({ ...line, process: "Pintura", hrPlan: 1 })] };
    await importSheets(v1, "proyectos");
    const counts = async () => ({
      projects: await prisma.project.count(),
      lamps: await prisma.lamp.count(),
      elements: await prisma.lampElement.count(),
      tasks: await prisma.task.count(),
    });
    const first = await counts();
    expect(first).toEqual({ projects: 1, lamps: 1, elements: 1, tasks: 2 });

    const v2 = { [PROYECTOS]: [proyecto({ ...line, process: "CNC", hrPlan: 5 }), proyecto({ ...line, process: "Pintura", hrPlan: 1 })] };
    const again = await uploadAndPreview<ProyectoRowDraft>(v2, "proyectos");
    // La vista previa ya reconoce el proyecto, la lámpara y la tarea existentes.
    expect(again.rows.map((r) => r.action)).toEqual(["update", "update"]);
    expect(again.rows.every((r) => r.taskId != null)).toBe(true);
    const result = await applyImportPreview({ sessionId: again.sessionId, importKind: "proyectos", rows: again.rows });
    expect(result.proyectos).toMatchObject({ projectsCreated: 0, lampsCreated: 0, tasksCreated: 0, tasksUpdated: 2 });

    expect(await counts()).toEqual(first);
    const tasks = await prisma.task.findMany({ orderBy: { process: "asc" } });
    expect(tasks.map((t) => [t.process, t.estimatedHours])).toEqual([["CNC", 5], ["PINTURA", 1]]);
  });

  it("dos filas iguales en el mismo Excel generan una sola tarea", async () => {
    const row = proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: 3 });
    await importSheets({ [PROYECTOS]: [row, row] }, "proyectos");
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.lamp.count()).toBe(1);
  });

  it("marcar «Omitir» una fila válida en la revisión la deja fuera de la importación", async () => {
    const sheets = {
      [PROYECTOS]: [
        proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: 3 }),
        proyecto({ project: "Casa Pepe", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: 3 }),
      ],
    };
    const { rows, sessionId } = await uploadAndPreview<ProyectoRowDraft>(sheets, "proyectos", [
      { rowIndex: excelRow(1), patch: { action: "skip" } },
    ]);
    expect(byRow(rows, 1).action).toBe("skip");

    await applyImportPreview({ sessionId, importKind: "proyectos", rows });
    expect((await prisma.project.findMany()).map((p) => p.name)).toEqual(["Hotel Ritz"]);
  });

  it("es transaccional: si una escritura falla a mitad, no queda el proyecto de la primera fila", async () => {
    const { rows, sessionId } = await uploadAndPreview<ProyectoRowDraft>(
      {
        [PROYECTOS]: [
          proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "TELA", process: "CNC", hrPlan: 3 }),
          proyecto({ project: "Casa Pepe", lamp: "L2", frame: "TELA", process: "CNC", hrPlan: 3 }),
        ],
      },
      "proyectos",
    );
    // NUL en un texto: Postgres falla al escribir la segunda lámpara, con la primera ya escrita en la tx.
    const poisoned = rows.map((r, i) => (i === 1 ? { ...r, lampName: "L\u00002" } : r));

    expectFail(await applyImportPreviewAction({ sessionId, importKind: "proyectos", rows: poisoned }));
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.lamp.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe("importar horas (hoja horas)", () => {
  const MONDAY = new Date(Date.UTC(2026, 9, 19));
  const TUESDAY = new Date(Date.UTC(2026, 9, 20));
  const iso = (d: Date, hhmm: string) => `${d.toISOString().slice(0, 10)}T${hhmm}:00.000Z`;

  /** Proyecto real creado desde la web: Hotel Test / Lámpara A / TELA 2 m² (CNC → ENSAMBLAJE → PINTURA). */
  async function createRealLamp() {
    const project = await createProject({ name: "Hotel Test", kind: ProjectKind.PRODUCCION, isBillable: true });
    const lamp = await createLamp({
      projectId: project.id,
      name: "Lámpara A",
      elements: [{ typology: ElementTypology.TELA, elementTypeId: world.tela.id, surfaceM2: 2, units: 1 }],
    });
    const tasks = await prisma.task.findMany({ where: { lampId: lamp.id } });
    const taskId = (process: string) => tasks.find((t) => t.process === process)!.id;
    return { projectId: project.id, lampId: lamp.id, taskId };
  }

  const base = { project: "Hotel Test", lamp: "Lámpara A" };

  it("imputa cada fila al operario, tarea y lámpara, y reparte las horas en su jornada respetando la comida", async () => {
    const real = await createRealLamp();
    const sheets = {
      [HORAS]: [
        horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 3 }),
        horas({ ...base, date: MONDAY, operator: "ana", process: "Ensamblaje", normal: 3, extra: 1, notes: "repaso" }),
        horas({ ...base, date: TUESDAY, operator: "Bea", process: "Pintura", normal: 1.5, start: "09:00", end: "10:30" }),
      ],
    };
    const { rows, sessionId, summary } = await uploadAndPreview<HorasRowDraft>(sheets, "horas");
    expect(summary).toMatchObject({ total: 3, error: 0, willCreate: 3 });

    const result = await applyImportPreview({ sessionId, importKind: "horas", rows });
    expect(result.horas).toMatchObject({ created: 3, skipped: 0 });

    const entries = await prisma.timeEntry.findMany({ orderBy: { startedAt: "asc" } });
    expect(
      entries.map((e) => ({
        userId: e.userId,
        taskId: e.taskId,
        lampId: e.lampId,
        projectId: e.projectId,
        process: e.process,
        hours: e.hours,
        startedAt: e.startedAt.toISOString(),
        endedAt: e.endedAt?.toISOString(),
        source: e.source,
      })),
    ).toEqual([
      {
        userId: world.users.ana.id, taskId: real.taskId("CNC"), lampId: real.lampId, projectId: real.projectId,
        process: "CNC", hours: 3, startedAt: iso(MONDAY, "08:00"), endedAt: iso(MONDAY, "11:00"), source: TimeEntrySource.MANUAL,
      },
      {
        // 3 h de mañana (11-14) + 1 h tras la comida (15-16): normales + extras.
        userId: world.users.ana.id, taskId: real.taskId("ENSAMBLAJE"), lampId: real.lampId, projectId: real.projectId,
        process: "ENSAMBLAJE", hours: 4, startedAt: iso(MONDAY, "11:00"), endedAt: iso(MONDAY, "16:00"), source: TimeEntrySource.MANUAL,
      },
      {
        userId: world.users.bea.id, taskId: real.taskId("PINTURA"), lampId: real.lampId, projectId: real.projectId,
        process: "PINTURA", hours: 1.5, startedAt: iso(TUESDAY, "09:00"), endedAt: iso(TUESDAY, "10:30"), source: TimeEntrySource.MANUAL,
      },
    ]);
    expect(entries[1]!.notes).toMatch(/repaso/);
  });

  it("rechaza con mensaje claro operarios, proyectos, lámparas y procesos que no existen", async () => {
    await createRealLamp();
    const sheets = {
      [HORAS]: [
        horas({ ...base, date: MONDAY, operator: "Zoe", process: "CNC", normal: 2 }),
        horas({ date: MONDAY, operator: "Ana", project: "Proyecto fantasma", lamp: "Lámpara A", process: "CNC", normal: 2 }),
        horas({ date: MONDAY, operator: "Ana", project: "Hotel Test", lamp: "Lámpara Z", process: "CNC", normal: 2 }),
        horas({ ...base, date: MONDAY, operator: "Ana", process: "Lijado", normal: 2 }),
        horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: null }),
      ],
    };
    const { rows, sessionId } = await uploadAndPreview<HorasRowDraft>(sheets, "horas");
    const messages = (i: number) => byRow(rows, i).issues.map((x) => x.message);
    expect(messages(0)).toContain('Operario no encontrado: "Zoe"');
    expect(messages(1)).toContain('Proyecto no encontrado: "Proyecto fantasma" (importa Proyectos antes)');
    expect(messages(2)).toContain('Lámpara no encontrada en el proyecto: "Lámpara Z"');
    expect(messages(3)).toContain('Tarea no encontrada para proceso "Lijado"');
    expect(messages(4)).toContain("Faltan horas normales o extras");
    expect(rows.every((r) => r.status === "error" && r.action === "skip")).toBe(true);

    const result = await applyImportPreview({ sessionId, importKind: "horas", rows });
    expect(result.horas).toMatchObject({ created: 0, skipped: 5 });
    expect(await prisma.timeEntry.count()).toBe(0);
  });

  it("reimportar la hoja no duplica horas: solo entran las filas añadidas desde la última importación", async () => {
    await createRealLamp();
    const v1 = [
      horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 3 }),
      horas({ ...base, date: MONDAY, operator: "Bea", process: "Pintura", normal: 2 }),
    ];
    await importSheets({ [HORAS]: v1 }, "horas");
    expect(await prisma.timeEntry.count()).toBe(2);

    // La hoja legacy crece por abajo: mismas filas + una nueva.
    const v2 = [...v1, horas({ ...base, date: TUESDAY, operator: "Ana", process: "Ensamblaje", normal: 1 })];
    const again = await uploadAndPreview<HorasRowDraft>({ [HORAS]: v2 }, "horas");
    expect(again.rows.map((r) => [r.status, r.action])).toEqual([
      ["warning", "skip"],
      ["warning", "skip"],
      ["ok", "create"],
    ]);
    expect(byRow(again.rows, 0).issues.map((i) => i.message)).toContain("Esta fila ya fue importada anteriormente");

    const result = await applyImportPreview({ sessionId: again.sessionId, importKind: "horas", rows: again.rows });
    expect(result.horas).toMatchObject({ created: 1, skipped: 2 });
    const entries = await prisma.timeEntry.findMany({ orderBy: { startedAt: "asc" } });
    expect(entries.map((e) => [e.process, e.hours])).toEqual([["CNC", 3], ["PINTURA", 2], ["ENSAMBLAJE", 1]]);

    // Aunque el cliente reenvíe las filas ya importadas como «crear», el servidor no las duplica.
    const third = await uploadAndPreview<HorasRowDraft>({ [HORAS]: v2 }, "horas");
    const forced = third.rows.map((r) => ({ ...r, action: "create" as const }));
    await applyImportPreview({ sessionId: third.sessionId, importKind: "horas", rows: forced });
    expect(await prisma.timeEntry.count()).toBe(3);
  });

  it("marcar «Omitir» una fila válida la deja fuera", async () => {
    await createRealLamp();
    const sheets = {
      [HORAS]: [
        horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 3 }),
        horas({ ...base, date: MONDAY, operator: "Bea", process: "Pintura", normal: 2 }),
      ],
    };
    const { rows, sessionId } = await uploadAndPreview<HorasRowDraft>(sheets, "horas", [
      { rowIndex: excelRow(1), patch: { action: "skip" } },
    ]);
    await applyImportPreview({ sessionId, importKind: "horas", rows });
    const entries = await prisma.timeEntry.findMany();
    expect(entries.map((e) => e.userId)).toEqual([world.users.ana.id]);
  });

  it("la marca de «ya importada» va por contenido: reordenar la hoja y añadir una fila importa solo la nueva", async () => {
    await createRealLamp();
    const anaCnc = horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 2 });
    const beaPint = horas({ ...base, date: MONDAY, operator: "Bea", process: "Pintura", normal: 2 });
    // Dos partes idénticos (mañana y tarde en la misma tarea) son dos entradas reales.
    const anaEns = horas({ ...base, date: TUESDAY, operator: "Ana", process: "Ensamblaje", normal: 1 });
    await importSheets({ [HORAS]: [anaCnc, beaPint, anaEns, anaEns] }, "horas");
    expect(await prisma.timeEntry.count()).toBe(4);

    // Hoja reordenada (otro orden, mismas filas) + una fila nueva en medio.
    const nueva = horas({ ...base, date: TUESDAY, operator: "Bea", process: "Pintura", normal: 1.5 });
    const again = await uploadAndPreview<HorasRowDraft>({ [HORAS]: [anaEns, beaPint, nueva, anaEns, anaCnc] }, "horas");
    expect(again.rows.map((r) => r.action)).toEqual(["skip", "skip", "create", "skip", "skip"]);
    expect(byRow(again.rows, 2).issues.map((i) => i.code)).not.toContain("ALREADY_IMPORTED");

    const result = await applyImportPreview({ sessionId: again.sessionId, importKind: "horas", rows: again.rows });
    expect(result.horas).toMatchObject({ created: 1 });
    const entries = await prisma.timeEntry.findMany({ where: { userId: world.users.bea.id }, orderBy: { startedAt: "asc" } });
    expect(entries.map((e) => [e.process, e.hours])).toEqual([["PINTURA", 2], ["PINTURA", 1.5]]);
    expect(await prisma.timeEntry.count()).toBe(5);
  });

  it("compatibilidad: las horas importadas con la marca antigua (por número de fila) no se duplican, aunque se reordene la hoja", async () => {
    await createRealLamp();
    const anaCnc = horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 3 });
    const beaPint = horas({ ...base, date: MONDAY, operator: "Bea", process: "Pintura", normal: 2 });
    await importSheets({ [HORAS]: [anaCnc, beaPint] }, "horas");
    // Así quedaron en producción las importaciones antiguas: `legacy-import:horas:row:N | notas`.
    const imported = await prisma.timeEntry.findMany({ orderBy: { startedAt: "asc" } });
    for (const entry of imported) {
      const sheetRow = excelRow(entry.process === "CNC" ? 0 : 1);
      await prisma.timeEntry.update({ where: { id: entry.id }, data: { notes: `legacy-import:horas:row:${sheetRow}` } });
    }

    // Mismo Excel: nada nuevo.
    const same = await uploadAndPreview<HorasRowDraft>({ [HORAS]: [anaCnc, beaPint] }, "horas");
    expect(same.rows.map((r) => [r.status, r.action])).toEqual([["warning", "skip"], ["warning", "skip"]]);

    // Reordenado y con una fila nueva: solo entra la nueva.
    const nueva = horas({ ...base, date: TUESDAY, operator: "Ana", process: "Ensamblaje", normal: 1 });
    const reordered = await uploadAndPreview<HorasRowDraft>({ [HORAS]: [nueva, beaPint, anaCnc] }, "horas");
    expect(reordered.rows.map((r) => r.action)).toEqual(["create", "skip", "skip"]);
    await applyImportPreview({ sessionId: reordered.sessionId, importKind: "horas", rows: reordered.rows });
    expect(await prisma.timeEntry.count()).toBe(3);
  });

  it("coloca las horas importadas en los huecos libres del operario y avisa si se solapan o no caben", async () => {
    const real = await createRealLamp();
    // Ana ya registró desde la app 2 h de CNC el lunes de 08:00 a 10:00.
    await loginAs(world.users.ana.email);
    unwrap(
      await createManualEntry({
        projectId: real.projectId,
        lampId: real.lampId,
        taskId: real.taskId("CNC"),
        process: "CNC",
        startedAt: iso(MONDAY, "08:00"),
        hours: 2,
      }),
    );
    await loginAs(world.users.admin.email);

    const { rows, sessionId } = await uploadAndPreview<HorasRowDraft>(
      {
        [HORAS]: [
          horas({ ...base, date: MONDAY, operator: "Ana", process: "CNC", normal: 3 }),
          horas({ ...base, date: MONDAY, operator: "Ana", process: "Ensamblaje", normal: 1, start: "09:00", end: "10:00" }),
          horas({ ...base, date: MONDAY, operator: "Ana", process: "Pintura", normal: 12 }),
        ],
      },
      "horas",
    );
    // Hueco libre: empieza tras el registro existente.
    expect(byRow(rows, 0)).toMatchObject({ status: "ok", action: "create" });
    expect(byRow(rows, 0).startedAt?.toISOString()).toBe(iso(MONDAY, "10:00"));
    expect(byRow(rows, 0).endedAt?.toISOString()).toBe(iso(MONDAY, "13:00"));
    // Tramo explícito que pisa el registro existente.
    expect(byRow(rows, 1)).toMatchObject({ status: "error", action: "skip" });
    expect(byRow(rows, 1).issues.map((i) => i.message)).toContain(
      "El tramo 09:00–10:00 se solapa con horas ya registradas o importadas de ese operario ese día. Ya tiene horas registradas ese día: 08:00–10:00.",
    );
    // 12 h más no caben en el resto del día (13:00-14:00, 15:00-24:00 = 10 h).
    expect(byRow(rows, 2)).toMatchObject({ status: "error", action: "skip" });
    expect(byRow(rows, 2).issues.map((i) => i.message)).toContain(
      "No caben 12.00 h ese día sin solaparse con otras horas del operario. Ya tiene horas registradas ese día: 08:00–10:00.",
    );

    await applyImportPreview({ sessionId, importKind: "horas", rows });
    const entries = await prisma.timeEntry.findMany({ where: { userId: world.users.ana.id }, orderBy: { startedAt: "asc" } });
    expect(entries.map((e) => [e.startedAt.toISOString(), e.endedAt?.toISOString()])).toEqual([
      [iso(MONDAY, "08:00"), iso(MONDAY, "10:00")],
      [iso(MONDAY, "10:00"), iso(MONDAY, "13:00")],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("migración completa (PRODUCCION.xlsx con las tres hojas)", () => {
  const MONDAY = new Date(Date.UTC(2026, 9, 19));
  const workbook = () => ({
    [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5), bbdd("Pantalla Oval", "Pintura", 0.4)],
    [PROYECTOS]: [
      proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "Pantalla Oval", m2: 2, process: "CNC", hrPlan: 1 }),
      proyecto({ project: "Hotel Ritz", lamp: "L1", frame: "Pantalla Oval", m2: 2, process: "Pintura", hrPlan: 0.8 }),
    ],
    [HORAS]: [horas({ date: MONDAY, operator: "Ana", project: "Hotel Ritz", lamp: "L1", process: "CNC", normal: 1.25 })],
  });

  /** Flujo del asistente para la migración completa; devuelve el ActionResult de confirmar. */
  async function migrate(sheets: Record<string, SheetRow[]>) {
    const inspected = await inspect(await excelFile(sheets), "produccion_completa");
    expect(inspected.importKind).toBe("produccion_completa");
    const preview = await buildImportPreview({
      sessionId: inspected.sessionId,
      importKind: "bastidores",
      mapping: inspected.suggestedMapping,
    });
    return applyImportPreviewAction({
      sessionId: inspected.sessionId,
      importKind: "produccion_completa",
      rows: preview.rows as BastidorRowDraft[],
    });
  }

  it("importa catálogo, proyectos y horas encadenados en una pasada, y repetirla no duplica nada", async () => {
    const run = async () => unwrap(await migrate(workbook()));

    const first = await run();
    expect(first.bastidores).toMatchObject({ created: 1 });
    expect(first.proyectos).toMatchObject({ projectsCreated: 1, lampsCreated: 1, tasksCreated: 2 });
    expect(first.horas).toMatchObject({ created: 1 });

    const oval = await prisma.elementType.findUniqueOrThrow({ where: { code: "pantalla-oval" } });
    const tasks = await prisma.task.findMany({ orderBy: { process: "asc" }, include: { lampElement: true } });
    expect(tasks.map((t) => [t.process, t.estimatedHours, t.lampElement?.elementTypeId])).toEqual([
      ["CNC", 1, oval.id],
      ["PINTURA", 0.8, oval.id],
    ]);
    const entry = await prisma.timeEntry.findFirstOrThrow();
    expect(entry).toMatchObject({ userId: world.users.ana.id, taskId: tasks[0]!.id, hours: 1.25 });

    const second = await run();
    expect(second.bastidores).toMatchObject({ created: 0, updated: 1 });
    expect(second.proyectos).toMatchObject({ tasksCreated: 0, tasksUpdated: 2 });
    expect(second.horas).toMatchObject({ created: 0 });
    expect(await prisma.elementType.count()).toBe(2);
    expect(await prisma.project.count()).toBe(1);
    expect(await prisma.task.count()).toBe(2);
    expect(await prisma.timeEntry.count()).toBe(1);
  });

  it("es atómica entre hojas: si falla al escribir las horas, no queda ni el catálogo ni los proyectos", async () => {
    // Fallo de BD inyectado al insertar horas (la última hoja), con catálogo y proyectos ya escritos en la tx.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION coverdec_test_fail_time_entry() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fallo simulado al guardar horas'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER coverdec_test_fail_time_entry BEFORE INSERT ON "TimeEntry"
      FOR EACH ROW EXECUTE FUNCTION coverdec_test_fail_time_entry()`);
    try {
      const error = expectFail(await migrate(workbook()));
      expect(error).toMatch(/fallo simulado al guardar horas/);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS coverdec_test_fail_time_entry ON "TimeEntry"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS coverdec_test_fail_time_entry()`);
    }

    expect(await prisma.elementType.findUnique({ where: { code: "pantalla-oval" } })).toBeNull();
    expect(await prisma.processDefinition.count()).toBe(6);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.timeEntry.count()).toBe(0);

    // Sin el fallo, el mismo libro se migra entero.
    const ok = unwrap(await migrate(workbook()));
    expect(ok.horas).toMatchObject({ created: 1 });
  });

  it("un libro sin hoja de horas migra catálogo y proyectos sin fallar", async () => {
    const { [HORAS]: _horas, ...sinHoras } = workbook();
    void _horas;
    const result = unwrap(await migrate(sinHoras));
    expect(result.bastidores).toMatchObject({ created: 1 });
    expect(result.proyectos).toMatchObject({ tasksCreated: 2 });
    expect(result.horas).toBeUndefined();
    expect(await prisma.task.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("formato del fichero y permisos", () => {
  it("rechaza un fichero que no es Excel o que excede 15 MB, y una hoja inexistente, con mensaje claro", async () => {
    const csv = new File(["Tipo;Proceso;Horas\nPantalla;CNC;0,5\n"], "bastidores.csv", { type: "text/csv" });
    expect(expectFail(await inspectImportFile(uploadForm(csv, "bastidores")))).toBe(
      "«bastidores.csv» no es un Excel (.xlsx) válido. Guárdalo como .xlsx y vuelve a subirlo.",
    );

    const huge = new File([new Uint8Array(15 * 1024 * 1024 + 1)], "enorme.xlsx");
    expect(expectFail(await inspectImportFile(uploadForm(huge, "bastidores")))).toBe(
      "El archivo supera el tamaño máximo (15 MB)",
    );

    expect(expectFail(await inspectImportFile(new FormData()))).toBe("No se recibió ningún archivo");

    const inspected = await inspect(await excelFile({ Hoja1: [bbdd("Pantalla", "CNC", 1)] }), "bastidores");
    // Sin hoja BBDD no se detecta ningún tipo importable y la hoja sugerida no existe.
    expect(inspected.availableKinds).toEqual([]);
    expect(inspected.sampleRowCount).toBe(0);
    expect(
      expectFail(
        await buildImportPreviewAction({
          sessionId: inspected.sessionId,
          importKind: "bastidores",
          mapping: inspected.suggestedMapping,
        }),
      ),
    ).toBe("Hoja no encontrada: BBDD");

    // Con el mapeo corregido a mano (hoja y columnas), la misma hoja sí se importa.
    const preview = await buildImportPreview({
      sessionId: inspected.sessionId,
      importKind: "bastidores",
      mapping: { ...inspected.suggestedMapping, sheetName: "Hoja1" },
    });
    expect(preview.summary).toMatchObject({ total: 1, ok: 1 });
  });

  it("una sesión de importación caducada o inventada no aplica nada", async () => {
    const expired = "La sesión de importación ha caducado (30 min). Vuelve a subir el archivo.";
    expect(
      expectFail(await applyImportPreviewAction({ sessionId: "no-existe", importKind: "produccion_completa", rows: [] })),
    ).toBe(expired);
    expect(
      expectFail(
        await buildImportPreviewAction({
          sessionId: "no-existe",
          importKind: "bastidores",
          mapping: { sheetName: BBDD, headerRow: 1, columnMap: {} },
        }),
      ),
    ).toBe(expired);
  });

  it("solo un admin puede importar: jefe de producción y operario son redirigidos y no se escribe nada", async () => {
    const sheets = { [BBDD]: [bbdd("Pantalla Oval", "CNC", 0.5)] };
    const { rows, sessionId } = await uploadAndPreview<BastidorRowDraft>(sheets, "bastidores");
    const before = await catalogSnapshot();

    for (const email of [world.users.jefe.email, world.users.ana.email]) {
      await loginAs(email);
      await expect(inspectImportFile(uploadForm(await excelFile(sheets), "bastidores"))).rejects.toThrow(/NEXT_REDIRECT/);
      await expect(
        buildImportPreviewAction({ sessionId, importKind: "bastidores", mapping: { sheetName: BBDD, headerRow: 1, columnMap: {} } }),
      ).rejects.toThrow(/NEXT_REDIRECT/);
      await expect(applyImportPreviewAction({ sessionId, importKind: "bastidores", rows })).rejects.toThrow(/NEXT_REDIRECT/);
    }
    expect(await catalogSnapshot()).toEqual(before);
  });
});
