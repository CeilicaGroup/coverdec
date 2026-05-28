import { describe, expect, it } from "vitest";
import { effectivePendingHours } from "../load-engine-input";

describe("effectivePendingHours re-export", () => {
  it("caps pendingHours by remaining when doneHours has increased", () => {
    expect(
      effectivePendingHours({ pendingHours: 6, doneHours: 4, estimatedHours: 8 }),
    ).toBe(4);
  });
});
