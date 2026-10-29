import { describe, expect, it } from "vitest";
import { splitOvertimeByEntry } from "@/features/time-tracking/overtime";

// 07:00 UTC = 08:00/09:00 en Madrid, mismo día civil.
const at = (day: string, hour: number) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`);

describe("splitOvertimeByEntry", () => {
  it("counts hours beyond 8 per person and day as extra, splitting the entry that crosses the limit", () => {
    const extra = splitOvertimeByEntry([
      { id: "b", userId: "ana", startedAt: at("2026-10-20", 12), hours: 4 }, // 4..9 h acumuladas → 1 extra
      { id: "a", userId: "ana", startedAt: at("2026-10-20", 7), hours: 5 },
      { id: "c", userId: "ana", startedAt: at("2026-10-20", 17), hours: 2 }, // todo extra
    ]);
    expect(extra.get("a")).toBeUndefined();
    expect(extra.get("b")).toBe(1);
    expect(extra.get("c")).toBe(2);
  });

  it("keeps each person and each day separate", () => {
    const extra = splitOvertimeByEntry([
      { id: "a1", userId: "ana", startedAt: at("2026-10-20", 7), hours: 6 },
      { id: "b1", userId: "bea", startedAt: at("2026-10-20", 7), hours: 6 },
      { id: "a2", userId: "ana", startedAt: at("2026-10-21", 7), hours: 6 },
    ]);
    expect(extra.size).toBe(0);
  });
});
