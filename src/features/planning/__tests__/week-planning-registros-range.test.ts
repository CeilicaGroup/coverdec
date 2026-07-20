import { describe, expect, it } from "vitest";
import { buildWeekPlanningRegistroStatusRange } from "@/features/planning/queries";

describe("buildWeekPlanningRegistroStatusRange", () => {
  it("builds contiguous range around anchor with flags", () => {
    const rows = buildWeekPlanningRegistroStatusRange({
      anchorWeekStart: new Date("2026-07-20T00:00:00.000Z"),
      beforeWeeks: 1,
      afterWeeks: 1,
      planningWeekStarts: [new Date("2026-07-13T00:00:00.000Z")],
      registroDates: [new Date("2026-07-22T09:00:00.000Z")],
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.weekStart.toISOString().slice(0, 10))).toEqual([
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
    expect(rows[0]?.hasPlanning).toBe(true);
    expect(rows[1]?.hasRegistros).toBe(true);
    expect(rows[2]).toEqual({
      weekStart: new Date("2026-07-27T00:00:00.000Z"),
      hasPlanning: false,
      hasRegistros: false,
    });
  });

  it("normalizes registro dates to monday bucket", () => {
    const rows = buildWeekPlanningRegistroStatusRange({
      anchorWeekStart: new Date("2026-07-20T00:00:00.000Z"),
      beforeWeeks: 0,
      afterWeeks: 0,
      planningWeekStarts: [],
      registroDates: [
        new Date("2026-07-20T00:00:00.000Z"),
        new Date("2026-07-24T23:59:59.000Z"),
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.hasRegistros).toBe(true);
  });
});
