import { describe, expect, it } from "vitest";
import { effectivePendingHours } from "../load-engine-input";

describe("effectivePendingHours re-export", () => {
  it("caps pendingHours by remaining when doneHours has increased", () => {
    expect(
      effectivePendingHours({
        pendingToPlanHours: 6,
        remainingWorkHours: 4,
        estimatedHours: 8,
      }),
    ).toBe(4);
  });
});
