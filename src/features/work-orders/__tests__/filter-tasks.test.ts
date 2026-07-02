import { describe, expect, it } from "vitest";
import {
  buildWorkOrderTaskFilterOptions,
  filterWorkOrderTasks,
} from "../filter-tasks";

const tasks = [
  {
    id: "t1",
    project: { id: "p1", name: "Proyecto A", code: "PA" },
    lamp: { name: "L1", elementType: { id: "et1", name: "Bastidor" } },
    lampElement: null,
    nave: { id: "n1", codigo: "N1", nombre: "Nave 1" },
    process: "CNC",
    processDefinition: { label: "CNC" },
    estimatedHours: 4,
  },
  {
    id: "t2",
    project: { id: "p2", name: "Proyecto B", code: "PB" },
    lamp: { name: "L2", elementType: { id: "et2", name: "Tela" } },
    lampElement: null,
    nave: { id: "n2", codigo: "N2", nombre: "Nave 2" },
    process: "PINT",
    processDefinition: { label: "Pintura" },
    estimatedHours: 2,
  },
];

describe("filterWorkOrderTasks", () => {
  it("filters by project", () => {
    const filtered = filterWorkOrderTasks(tasks, { projectId: "p1" });
    expect(filtered.map((t) => t.id)).toEqual(["t1"]);
  });

  it("filters by free-text search across fields", () => {
    const filtered = filterWorkOrderTasks(tasks, { search: "nave 2" });
    expect(filtered.map((t) => t.id)).toEqual(["t2"]);
  });

  it("combines process and element filters", () => {
    const filtered = filterWorkOrderTasks(tasks, {
      processCode: "CNC",
      elementTypeId: "et1",
    });
    expect(filtered.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("buildWorkOrderTaskFilterOptions", () => {
  it("builds unique sorted options from tasks", () => {
    const options = buildWorkOrderTaskFilterOptions(tasks);
    expect(options.projects).toHaveLength(2);
    expect(options.processes.map((p) => p.code)).toEqual(["CNC", "PINT"]);
    expect(options.elements.map((e) => e.id)).toEqual(["et1", "et2"]);
  });

  it("labels internal pools with friendly names", () => {
    const options = buildWorkOrderTaskFilterOptions([
      {
        ...tasks[0]!,
        id: "stock-task",
        project: {
          id: "stock-pool",
          name: "Pool de stock",
          code: "STOCK-POOL",
          kind: "STOCK",
        },
      },
      {
        ...tasks[1]!,
        id: "adhoc-task",
        project: {
          id: "imprevistas-pool",
          name: "Pool de imprevistas",
          code: "IMPREVISTAS-POOL",
          kind: "IMPREVISTAS",
        },
        process: "IMPREVISTA",
        processDefinition: { label: "Imprevista" },
        notes: "Arreglar montaje",
      },
    ]);

    expect(options.projects).toEqual([
      { id: "imprevistas-pool", label: "Imprevistas" },
      { id: "stock-pool", label: "Stock" },
    ]);
  });
});
