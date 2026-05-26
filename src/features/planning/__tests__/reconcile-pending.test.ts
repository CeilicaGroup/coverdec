import { describe, expect, it } from "vitest";

describe("reconcile pending formula", () => {
  it("expected pending is remaining minus prior planned hours", () => {
    const estimated = 8;
    const done = 0;
    const priorPlanned = 8;
    const remaining = Math.max(0, estimated - done);
    const expectedPending = Math.max(0, remaining - priorPlanned);
    expect(expectedPending).toBe(0);
  });

  it("keeps partial pending after partial prior planning", () => {
    const remaining = 8;
    const priorPlanned = 5;
    expect(Math.max(0, remaining - priorPlanned)).toBe(3);
  });
});
