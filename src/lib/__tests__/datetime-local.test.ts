import { describe, expect, it } from "vitest";
import {
  fromDatetimeLocalInputValue,
  toDatetimeLocalInputValue,
  toIsoUtcFromDateAndHour,
} from "../datetime-local";

describe("toIsoUtcFromDateAndHour", () => {
  it("maps 08:00 Madrid on a UTC calendar day to correct UTC instant (CEST)", () => {
    const day = new Date("2026-06-04T00:00:00.000Z");
    const iso = toIsoUtcFromDateAndHour(day, 8);
    expect(iso).toBe("2026-06-04T06:00:00.000Z");
    expect(toDatetimeLocalInputValue(iso)).toBe("2026-06-04T08:00");
  });

  it("round-trips datetime-local input through fromDatetimeLocalInputValue", () => {
    const iso = fromDatetimeLocalInputValue("2026-06-04T10:30");
    expect(toDatetimeLocalInputValue(iso)).toBe("2026-06-04T10:30");
  });
});
