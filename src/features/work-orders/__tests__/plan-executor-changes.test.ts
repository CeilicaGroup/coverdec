import { describe, expect, it } from "vitest";
import { planExecutorChanges } from "../plan-executor-changes";

describe("planExecutorChanges", () => {
  it("adds a second executor by cloning the existing person's rows", () => {
    const plan = planExecutorChanges(
      [
        { id: "r1", personId: "p1" },
        { id: "r2", personId: "p1" },
      ],
      ["p1", "p2"],
    );
    expect(plan).toEqual({
      rowIdsToDelete: [],
      personIdsToAdd: ["p2"],
      templateRowIds: ["r1", "r2"],
    });
  });

  it("removes a dropped executor's rows", () => {
    const plan = planExecutorChanges(
      [
        { id: "r1", personId: "p1" },
        { id: "r2", personId: "p2" },
      ],
      ["p1"],
    );
    expect(plan).toEqual({
      rowIdsToDelete: ["r2"],
      personIdsToAdd: [],
      templateRowIds: ["r1"],
    });
  });

  it("swaps one executor for another using the kept person's rows as template", () => {
    const plan = planExecutorChanges(
      [
        { id: "r1", personId: "p1" },
        { id: "r2", personId: "p2" },
      ],
      ["p1", "p3"],
    );
    expect(plan.rowIdsToDelete).toEqual(["r2"]);
    expect(plan.personIdsToAdd).toEqual(["p3"]);
    expect(plan.templateRowIds).toEqual(["r1"]);
  });

  it("is a no-op when the executor set is unchanged", () => {
    const plan = planExecutorChanges(
      [
        { id: "r1", personId: "p1" },
        { id: "r2", personId: "p2" },
      ],
      ["p1", "p2"],
    );
    expect(plan.rowIdsToDelete).toEqual([]);
    expect(plan.personIdsToAdd).toEqual([]);
  });

  it("returns no template when there are no existing rows", () => {
    const plan = planExecutorChanges([], ["p1"]);
    expect(plan).toEqual({
      rowIdsToDelete: [],
      personIdsToAdd: ["p1"],
      templateRowIds: [],
    });
  });
});
