import { describe, expect, it } from "vitest";
import {
  buildProcessBatchSuffix,
  isPaintProcess,
  isPrimerProcess,
  resolveRalFromLamp,
} from "@/features/production-orders/grouping-rules";
import { groupAssignmentsIntoBatches } from "@/features/production-orders/group-from-planning";

describe("grouping-rules", () => {
  it("resolves RAL from lamp field or notes", () => {
    expect(resolveRalFromLamp({ ral: "9005", name: "Cruz" }).ral).toBe("9005");
    expect(resolveRalFromLamp({ ral: null, notes: "Acabado RAL 9010", name: "X" }).ral).toBe(
      "9010",
    );
  });

  it("uses single batch suffix for imprimación", () => {
    expect(
      buildProcessBatchSuffix({
        process: "IMPRIMACION",
        elementTypeId: "et-mdf",
        ral: null,
        taskId: "t1",
        separateWorkOrder: true,
      }),
    ).toBe("elem:et-mdf");
  });

  it("splits paint batches by RAL", () => {
    expect(
      buildProcessBatchSuffix({
        process: "PINTURA",
        elementTypeId: "et-mdf",
        ral: "9005",
        taskId: "t1",
        separateWorkOrder: false,
      }),
    ).toContain("ral:9005");
    expect(isPaintProcess("PINTURA")).toBe(true);
    expect(isPrimerProcess("IMPRIMACION")).toBe(true);
  });
});

describe("groupAssignmentsIntoBatches", () => {
  const basePlanning = {
    naveId: "n1",
    weekStart: new Date("2026-05-04T00:00:00.000Z"),
    planningGroupId: "grp-1",
  };

  it("groups same process, nave and element type into one batch", () => {
    const batches = groupAssignmentsIntoBatches([
      {
        hours: 4,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t1",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p1",
          project: { name: "Proyecto A" },
          lamp: { ral: null, colorHex: null, notes: null, name: "L1", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: basePlanning,
      },
      {
        hours: 3,
        date: new Date("2026-05-06T00:00:00.000Z"),
        process: "CNC",
        task: {
          id: "t2",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p2",
          project: { name: "Proyecto B" },
          lamp: { ral: null, colorHex: null, notes: null, name: "L2", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 2 },
        },
        planning: basePlanning,
      },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.hours).toBe(7);
    expect(batches[0]!.lines).toHaveLength(2);
  });

  it("splits paint by RAL into separate batches", () => {
    const batches = groupAssignmentsIntoBatches([
      {
        hours: 2,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "PINTURA",
        task: {
          id: "t1",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p1",
          project: { name: "A" },
          lamp: { ral: "9005", colorHex: null, notes: null, name: "L1", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 6 },
        },
        planning: basePlanning,
      },
      {
        hours: 3,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "PINTURA",
        task: {
          id: "t2",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p2",
          project: { name: "B" },
          lamp: { ral: "9010", colorHex: null, notes: null, name: "L2", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 4 },
        },
        planning: basePlanning,
      },
    ]);

    expect(batches).toHaveLength(2);
    expect(batches.map((b) => b.batchRal).sort()).toEqual(["9005", "9010"]);
  });

  it("merges imprimación across separateWorkOrder flags", () => {
    const batches = groupAssignmentsIntoBatches([
      {
        hours: 2,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "IMPRIMACION",
        task: {
          id: "t1",
          naveId: "n1",
          separateWorkOrder: true,
          projectId: "p1",
          project: { name: "A" },
          lamp: { ral: null, colorHex: null, notes: null, name: "L1", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: basePlanning,
      },
      {
        hours: 3,
        date: new Date("2026-05-05T00:00:00.000Z"),
        process: "IMPRIMACION",
        task: {
          id: "t2",
          naveId: "n1",
          separateWorkOrder: false,
          projectId: "p2",
          project: { name: "B" },
          lamp: { ral: null, colorHex: null, notes: null, name: "L2", code: null },
          lampElement: { elementTypeId: "et-mdf", units: 1 },
        },
        planning: basePlanning,
      },
    ]);

    expect(batches).toHaveLength(1);
    expect(batches[0]!.lines).toHaveLength(2);
  });
});
