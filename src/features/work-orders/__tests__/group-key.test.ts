import { describe, expect, it } from "vitest";
import { workOrderGroupKey } from "../group-key";
import { groupTasksForAutoWorkOrders } from "../queries";

describe("workOrderGroupKey", () => {
  it("uses lampElement element type when present", () => {
    const key = workOrderGroupKey({
      process: "CNC",
      lampElement: { elementType: { id: "et-1" } },
      lamp: { elementType: { id: "et-2" } },
    });
    expect(key).toBe("et-1:CNC");
  });

  it("falls back to lamp element type", () => {
    const key = workOrderGroupKey({
      process: "PINT",
      lampElement: null,
      lamp: { elementType: { id: "et-2" } },
    });
    expect(key).toBe("et-2:PINT");
  });

  it("returns null without element type", () => {
    expect(
      workOrderGroupKey({ process: "CNC", lampElement: null, lamp: {} }),
    ).toBeNull();
  });
});

describe("groupTasksForAutoWorkOrders", () => {
  const base = {
    lampElement: { elementType: { id: "et-1" } },
    lamp: null as { elementType?: { id: string } | null } | null,
  };

  it("groups tasks with same element type and process", () => {
    const groups = groupTasksForAutoWorkOrders([
      { id: "t1", process: "CNC", ...base },
      { id: "t2", process: "CNC", ...base },
      { id: "t3", process: "PINT", ...base },
    ]);
    expect(groups.size).toBe(1);
    expect(groups.get("et-1:CNC")?.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("ignores single-task groups", () => {
    const groups = groupTasksForAutoWorkOrders([
      { id: "t1", process: "CNC", ...base },
    ]);
    expect(groups.size).toBe(0);
  });
});
