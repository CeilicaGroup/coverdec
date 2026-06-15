import { describe, expect, it } from "vitest";
import { resolveOwnerPersonIdByTaskId } from "../load-engine-input";
import { buildOwnerPersonIdByTaskId } from "../prior-week-planning";

describe("resolveOwnerPersonIdByTaskId", () => {
  it("prefers time-entry worker over prior planning", () => {
    const owner = resolveOwnerPersonIdByTaskId(
      ["t1"],
      new Map([["t1", "from-time"]]),
      new Map([["t1", "from-prior"]]),
      new Map([["t1", "from-week"]]),
    );
    expect(owner.get("t1")).toBe("from-time");
  });

  it("falls back to prior planning when no time entries", () => {
    const owner = resolveOwnerPersonIdByTaskId(
      ["t1"],
      new Map(),
      new Map([["t1", "from-prior"]]),
      new Map([["t1", "from-week"]]),
    );
    expect(owner.get("t1")).toBe("from-prior");
  });

  it("uses current-week fixed assignments as last resort", () => {
    const owner = resolveOwnerPersonIdByTaskId(
      ["t1"],
      new Map(),
      new Map(),
      new Map([["t1", "from-week"]]),
    );
    expect(owner.get("t1")).toBe("from-week");
  });
});

describe("buildOwnerPersonIdByTaskId", () => {
  it("keeps the most recent assignment per task", () => {
    const monday = new Date("2026-05-04T00:00:00.000Z");
    const tuesday = new Date("2026-05-05T00:00:00.000Z");
    const owner = buildOwnerPersonIdByTaskId([
      { taskId: "t1", personId: "p1", date: monday, endSlot: 4 },
      { taskId: "t1", personId: "p2", date: tuesday, endSlot: 2 },
    ]);
    expect(owner.get("t1")).toBe("p2");
  });
});
