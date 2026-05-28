import { describe, expect, it } from "vitest";
import { resolveTimeEntryHours } from "../entry-hours";

describe("resolveTimeEntryHours", () => {
  const startedAt = new Date("2026-05-11T08:00:00.000Z");

  it("uses stored hours for closed entries", () => {
    expect(
      resolveTimeEntryHours({
        startedAt,
        endedAt: new Date("2026-05-11T10:00:00.000Z"),
        hours: 2,
      }),
    ).toBe(2);
  });

  it("treats open entries as closed at `at`", () => {
    const at = new Date("2026-05-11T09:30:00.000Z");
    expect(
      resolveTimeEntryHours(
        { startedAt, endedAt: null, hours: null },
        at,
      ),
    ).toBe(1.5);
  });

  it("computes duration when closed without hours field", () => {
    const endedAt = new Date("2026-05-11T09:00:00.000Z");
    expect(
      resolveTimeEntryHours({ startedAt, endedAt, hours: null }, endedAt),
    ).toBe(1);
  });
});
