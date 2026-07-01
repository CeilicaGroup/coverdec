import { describe, expect, it } from "vitest";
import {
  assertConsistentWorkOrderOwners,
  findWorkOrderOwnerConflicts,
  openWorkOrderFields,
  propagateWorkOrderOwnerByTaskId,
} from "../planning";

const openWo = { status: "OPEN" as const };

describe("propagateWorkOrderOwnerByTaskId", () => {
  it("propagates owner from one task to all in the same work order", () => {
    const owner = propagateWorkOrderOwnerByTaskId(
      [
        { id: "t1", workOrderId: "wo-1", workOrderSequence: 0, workOrder: openWo },
        { id: "t2", workOrderId: "wo-1", workOrderSequence: 1, workOrder: openWo },
        { id: "t3", workOrderId: "wo-2", workOrderSequence: 0, workOrder: openWo },
      ],
      new Map([["t1", "person-a"]]),
    );
    expect(owner.get("t1")).toBe("person-a");
    expect(owner.get("t2")).toBe("person-a");
    expect(owner.get("t3")).toBeUndefined();
  });

  it("uses the earliest sequenced task that already has an owner", () => {
    const owner = propagateWorkOrderOwnerByTaskId(
      [
        { id: "t1", workOrderId: "wo-1", workOrderSequence: 1, workOrder: openWo },
        { id: "t2", workOrderId: "wo-1", workOrderSequence: 0, workOrder: openWo },
      ],
      new Map([
        ["t1", "person-late"],
        ["t2", "person-first"],
      ]),
    );
    expect(owner.get("t1")).toBe("person-first");
    expect(owner.get("t2")).toBe("person-first");
  });
});

describe("findWorkOrderOwnerConflicts", () => {
  it("detects multiple owners on the same open work order", () => {
    const conflicts = findWorkOrderOwnerConflicts(
      [
        {
          id: "t1",
          workOrderId: "wo-1",
          workOrder: { status: "OPEN", number: "OT0001-2026" },
        },
        {
          id: "t2",
          workOrderId: "wo-1",
          workOrder: { status: "OPEN", number: "OT0001-2026" },
        },
      ],
      new Map([
        ["t1", "p1"],
        ["t2", "p2"],
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.personIds).toEqual(["p1", "p2"]);
  });
});

describe("assertConsistentWorkOrderOwners", () => {
  it("throws when owners conflict within a work order", () => {
    expect(() =>
      assertConsistentWorkOrderOwners(
        [
          {
            id: "t1",
            workOrderId: "wo-1",
            workOrder: { status: "OPEN", number: "OT0001-2026" },
          },
          {
            id: "t2",
            workOrderId: "wo-1",
            workOrder: { status: "OPEN", number: "OT0001-2026" },
          },
        ],
        new Map([
          ["t1", "p1"],
          ["t2", "p2"],
        ]),
      ),
    ).toThrow(/operarios distintos/);
  });
});

describe("openWorkOrderFields", () => {
  it("returns null fields for closed work orders", () => {
    expect(
      openWorkOrderFields({
        workOrderId: "wo-1",
        workOrderSequence: 1,
        workOrder: { status: "CLOSED" },
      }),
    ).toEqual({ workOrderId: null, workOrderSequence: null });
  });

  it("keeps fields for open work orders", () => {
    expect(
      openWorkOrderFields({
        workOrderId: "wo-1",
        workOrderSequence: 2,
        workOrder: { status: "OPEN" },
      }),
    ).toEqual({ workOrderId: "wo-1", workOrderSequence: 2 });
  });
});
