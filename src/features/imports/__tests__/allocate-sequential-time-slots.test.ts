import { describe, expect, it } from "vitest";
import { allocateSequentialTimeSlots } from "../allocate-sequential-time-slots";

describe("allocateSequentialTimeSlots", () => {
  const workDate = new Date(Date.UTC(2025, 11, 18));

  it("allocates sequential blocks within default windows", () => {
    const result = allocateSequentialTimeSlots({
      workDate,
      entries: [
        { rowIndex: 2, hours: 4, startTimeMinutes: null, endTimeMinutes: null },
        { rowIndex: 3, hours: 2, startTimeMinutes: null, endTimeMinutes: null },
      ],
    });
    expect(result.slots).toHaveLength(2);
    expect(result.slots[0]!.startedAt.toISOString()).toBe("2025-12-18T08:00:00.000Z");
    expect(result.slots[0]!.endedAt.toISOString()).toBe("2025-12-18T12:00:00.000Z");
    expect(result.slots[1]!.startedAt.toISOString()).toBe("2025-12-18T12:00:00.000Z");
    expect(result.slots[1]!.endedAt.toISOString()).toBe("2025-12-18T14:00:00.000Z");
  });

  it("uses explicit start and end times when provided", () => {
    const result = allocateSequentialTimeSlots({
      workDate,
      entries: [
        {
          rowIndex: 5,
          hours: 2,
          startTimeMinutes: 8 * 60,
          endTimeMinutes: 10 * 60,
        },
      ],
    });
    expect(result.slots[0]!.startedAt.toISOString()).toBe("2025-12-18T08:00:00.000Z");
    expect(result.slots[0]!.endedAt.toISOString()).toBe("2025-12-18T10:00:00.000Z");
  });

  it("warns on schedule overflow", () => {
    const result = allocateSequentialTimeSlots({
      workDate,
      entries: [
        { rowIndex: 1, hours: 10, startTimeMinutes: null, endTimeMinutes: null },
      ],
    });
    expect(result.warnings.some((w) => w.code === "SCHEDULE_OVERFLOW")).toBe(true);
    expect(result.slots[0]!.overflow).toBe(true);
  });
});
