import { describe, expect, it } from "vitest";
import { buildGeneralView, type GeneralViewTaskInput } from "@/features/reports/general-view";

function task(overrides: Partial<GeneralViewTaskInput> & { id: string }): GeneralViewTaskInput {
  return {
    process: "CNC",
    estimatedHours: 10,
    isCompleted: false,
    order: 0,
    projectId: "p1",
    projectName: "Druni",
    deliveryDate: new Date("2026-11-30"),
    lampId: "l1",
    lampName: "Gracos",
    frameTypeName: "BASTIDOR 150",
    surfaceM2: 50,
    ...overrides,
  };
}

describe("buildGeneralView", () => {
  it("sums multi-unit tasks into one row per process, with deviation, progress and status", () => {
    const view = buildGeneralView(
      [
        task({ id: "t1", estimatedHours: 10, isCompleted: true }),
        task({ id: "t2", estimatedHours: 10 }),
        task({ id: "t3", process: "PINTURA", estimatedHours: 5, order: 1 }),
      ],
      new Map([
        ["t1", 12],
        ["t2", 3],
      ]),
    );

    const [cnc, pintura] = view.projects[0]!.rows;
    expect(cnc).toMatchObject({
      process: "CNC",
      units: 2,
      planHours: 20,
      realHours: 15,
      pendingHours: 7, // t1 terminada no deja pendiente; t2 lleva 3 de 10
      deviationPct: -25,
      progressPct: 65, // completada acredita su plan (10) + 3 fichadas
      status: "EN_CURSO",
    });
    expect(pintura).toMatchObject({
      planHours: 5,
      realHours: 0,
      deviationPct: null, // sin fichajes no hay desviación
      status: "PENDIENTE",
      progressPct: 0,
    });
    expect(view.projects[0]!.totals).toMatchObject({ planHours: 25, realHours: 15, pendingHours: 12 });
  });

  it("splits real hours into normal and extra per row and in totals", () => {
    const view = buildGeneralView(
      [task({ id: "t1" }), task({ id: "t2" })],
      new Map([
        ["t1", 9],
        ["t2", 3],
      ]),
      new Map([["t1", 1]]),
    );
    expect(view.projects[0]!.rows[0]).toMatchObject({ realHours: 12, normalHours: 11, extraHours: 1 });
    expect(view.totals).toMatchObject({ normalHours: 11, extraHours: 1 });
  });

  it("marks fully completed processes as finished and handles zero plan", () => {
    const view = buildGeneralView(
      [task({ id: "t1", estimatedHours: 0, isCompleted: true })],
      new Map([["t1", 2]]),
    );
    expect(view.projects[0]!.rows[0]).toMatchObject({
      status: "TERMINADO",
      deviationPct: null,
      progressPct: 100,
    });
  });

  it("orders projects by delivery date (undated last) and totals across projects", () => {
    const view = buildGeneralView(
      [
        task({ id: "a", projectId: "late", projectName: "B", deliveryDate: null }),
        task({ id: "b", projectId: "soon", projectName: "A", deliveryDate: new Date("2026-11-01") }),
      ],
      new Map([["a", 10]]),
    );
    expect(view.projects.map((p) => p.projectId)).toEqual(["soon", "late"]);
    expect(view.totals).toMatchObject({ planHours: 20, realHours: 10, deviationPct: -50 });
  });
});
