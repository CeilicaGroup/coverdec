import { describe, expect, it } from "vitest";
import { WorkOrderStatus } from "@/generated/prisma";
import {
  findTasksMissingOpenWorkOrder,
  formatMissingWorkOrderError,
} from "../require-for-planning";
import {
  summarizeWorkOrderAssignee,
  summarizeWorkOrderElementProcess,
} from "../display-context";

const baseTask = {
  project: { id: "p1", name: "Proyecto", code: "P" },
  lamp: { name: "L1", elementType: { id: "et1", name: "Bastidor" } },
  lampElement: null,
  nave: { id: "n1", codigo: "N1", nombre: "Nave" },
  processDefinition: { label: "CNC" },
  estimatedHours: 4,
};

describe("summarizeWorkOrderElementProcess", () => {
  it("shows single element and process when all tasks share the same key", () => {
    const summary = summarizeWorkOrderElementProcess([
      { id: "t1", process: "CNC", ...baseTask },
      { id: "t2", process: "CNC", ...baseTask, lamp: { name: "L2", elementType: { id: "et1", name: "Bastidor" } } },
    ]);
    expect(summary).toEqual({
      kind: "single",
      elementName: "Bastidor",
      processCode: "CNC",
    });
  });

  it("shows multiple when element or process differ", () => {
    const summary = summarizeWorkOrderElementProcess([
      { id: "t1", process: "CNC", ...baseTask },
      {
        id: "t2",
        process: "PINT",
        ...baseTask,
        processDefinition: { label: "Pintura" },
      },
    ]);
    expect(summary).toEqual({ kind: "multiple", count: 2 });
  });

  it("falls back to first task when no grouping key exists", () => {
    const summary = summarizeWorkOrderElementProcess([
      {
        id: "t1",
        process: "OPERO",
        ...baseTask,
        lampElement: null,
        lamp: { name: "L1", elementType: null },
      },
    ]);
    expect(summary).toEqual({
      kind: "single",
      elementName: "—",
      processCode: "OPERO",
    });
  });
});

describe("summarizeWorkOrderAssignee", () => {
  it("returns single assignee when all tasks share the same person", () => {
    const map = new Map([
      ["t1", { personId: "p1", label: "Ana", iniciales: "AB" }],
      ["t2", { personId: "p1", label: "Ana", iniciales: "AB" }],
    ]);
    expect(summarizeWorkOrderAssignee(["t1", "t2"], map)).toEqual({
      kind: "single",
      assignee: { personId: "p1", label: "Ana", iniciales: "AB" },
    });
  });

  it("returns multiple when assignees differ", () => {
    const map = new Map([
      ["t1", { personId: "p1", label: "Ana", iniciales: "AB" }],
      ["t2", { personId: "p2", label: "Bob", iniciales: "CD" }],
    ]);
    expect(summarizeWorkOrderAssignee(["t1", "t2"], map)).toEqual({
      kind: "multiple",
    });
  });
});

describe("findTasksMissingOpenWorkOrder", () => {
  const row = {
    id: "t1",
    workOrderId: "wo1",
    workOrder: { status: WorkOrderStatus.OPEN, number: "OT0001-2026" },
    project: { name: "Proyecto" },
    lamp: { name: "L1" },
    processDefinition: { label: "CNC" },
  };

  it("flags tasks without work order or with closed work order", () => {
    expect(findTasksMissingOpenWorkOrder([row])).toEqual([]);
    expect(
      findTasksMissingOpenWorkOrder([
        { ...row, workOrderId: null, workOrder: null },
      ]),
    ).toHaveLength(1);
    expect(
      findTasksMissingOpenWorkOrder([
        {
          ...row,
          workOrder: { status: WorkOrderStatus.CLOSED, number: "OT0001-2026" },
        },
      ]),
    ).toHaveLength(1);
  });
});

describe("formatMissingWorkOrderError", () => {
  it("includes actionable task lines", () => {
    const message = formatMissingWorkOrderError([
      {
        id: "t1",
        workOrderId: null,
        workOrder: null,
        project: { name: "Proyecto" },
        lamp: { name: "L1" },
        processDefinition: { label: "CNC" },
      },
    ]);
    expect(message).toContain("sin OT abierta");
    expect(message).toContain("Proyecto · L1 · CNC");
  });
});
