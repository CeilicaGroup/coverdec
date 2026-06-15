import { describe, expect, it } from "vitest";
import {
  computePlanFromBounds,
  defaultPlanFromDateIso,
  relaxFirstSchedulableDayForChain,
  resolvePlanFromAnchor,
  weekWorkdayIsoRange,
} from "../plan-from";

const weekStart = new Date("2026-05-04T00:00:00.000Z");

describe("resolvePlanFromAnchor", () => {
  it("WEEK_START is monday of the viewed week", () => {
    const at = new Date("2026-05-07T14:00:00.000Z");
    expect(resolvePlanFromAnchor(weekStart, "WEEK_START", at).toISOString()).toBe(
      weekStart.toISOString(),
    );
  });

  it("TOMORROW is next calendar day from planFromAt", () => {
    const at = new Date("2026-05-07T14:00:00.000Z");
    expect(resolvePlanFromAnchor(weekStart, "TOMORROW", at).toISOString()).toBe(
      "2026-05-08T00:00:00.000Z",
    );
  });

  it("DATE uses the selected calendar day at midnight", () => {
    const at = new Date("2026-05-05T00:00:00.000Z");
    expect(resolvePlanFromAnchor(weekStart, "DATE", at).toISOString()).toBe(
      "2026-05-05T00:00:00.000Z",
    );
  });
});

describe("computePlanFromBounds", () => {
  it("TODAY midweek starts on wednesday without quarter", () => {
    const at = new Date("2026-05-06T10:15:00.000Z");
    expect(computePlanFromBounds(weekStart, "TODAY", at)).toEqual({
      firstSchedulableDayIndex: 2,
    });
  });

  it("NOW on wednesday adds week quarter", () => {
    const at = new Date("2026-05-06T10:15:00.000Z");
    const bounds = computePlanFromBounds(weekStart, "NOW", at);
    expect(bounds.firstSchedulableDayIndex).toBe(2);
    expect(bounds.firstSchedulableWeekQuarter).toBe(2 * 24 * 4 + Math.floor((10 * 60 + 15) / 15));
  });

  it("TOMORROW from thursday anchors friday at midnight", () => {
    const at = new Date("2026-05-07T16:00:00.000Z");
    expect(computePlanFromBounds(weekStart, "TOMORROW", at)).toEqual({
      firstSchedulableDayIndex: 4,
    });
  });

  it("returns no schedulable days when anchor is after the work week", () => {
    const at = new Date("2026-05-10T12:00:00.000Z");
    expect(computePlanFromBounds(weekStart, "TODAY", at)).toEqual({
      firstSchedulableDayIndex: 5,
    });
  });

  it("DATE before today in the same week starts on monday", () => {
    const at = new Date("2026-05-04T00:00:00.000Z");
    expect(computePlanFromBounds(weekStart, "DATE", at)).toEqual({
      firstSchedulableDayIndex: 0,
    });
  });
});

describe("defaultPlanFromDateIso", () => {
  it("defaults to today when it falls inside the work week", () => {
    const at = new Date("2026-05-06T12:00:00.000Z");
    expect(defaultPlanFromDateIso(weekStart, at)).toBe("2026-05-06");
  });

  it("defaults to monday when today is before the work week", () => {
    const at = new Date("2026-05-01T12:00:00.000Z");
    expect(defaultPlanFromDateIso(weekStart, at)).toBe("2026-05-04");
  });

  it("defaults to monday when today is after the work week", () => {
    const at = new Date("2026-05-10T12:00:00.000Z");
    expect(defaultPlanFromDateIso(weekStart, at)).toBe("2026-05-04");
  });
});

describe("weekWorkdayIsoRange", () => {
  it("returns monday and friday of the viewed week", () => {
    expect(weekWorkdayIsoRange(weekStart)).toEqual({
      mondayIso: "2026-05-04",
      fridayIso: "2026-05-08",
    });
  });
});

describe("relaxFirstSchedulableDayForChain", () => {
  it("allows earlier days when process chain requires them", () => {
    const mondayQuarter = 0;
    expect(
      relaxFirstSchedulableDayForChain(2, 2 * 24 * 4, [mondayQuarter]),
    ).toEqual({
      firstSchedulableDayIndex: 0,
      firstSchedulableWeekQuarter: undefined,
    });
  });

  it("keeps plan-from bounds when chain does not require earlier days", () => {
    const wednesdayQuarter = 2 * 24 * 4;
    expect(
      relaxFirstSchedulableDayForChain(2, wednesdayQuarter, [wednesdayQuarter]),
    ).toEqual({
      firstSchedulableDayIndex: 2,
      firstSchedulableWeekQuarter: wednesdayQuarter,
    });
  });
});
