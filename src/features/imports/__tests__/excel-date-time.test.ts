import { describe, expect, it } from "vitest";
import {
  combineDateAndTime,
  excelSerialToDate,
  readExcelDate,
  readExcelTimeOfDay,
} from "../excel-date-time";

describe("excel-date-time", () => {
  it("converts Excel serial to UTC date", () => {
    const d = excelSerialToDate(46080);
    expect(d.toISOString().slice(0, 10)).toBe("2026-02-27");
  });

  it("reads numeric serial dates", () => {
    const d = readExcelDate(46080);
    expect(d?.toISOString().slice(0, 10)).toBe("2026-02-27");
  });

  it("reads time fraction as minutes", () => {
    expect(readExcelTimeOfDay(0.3333333333)).toBeCloseTo(8 * 60, 0);
  });

  it("reads time-only Date as minutes", () => {
    const t = new Date(Date.UTC(1899, 11, 30, 10, 30));
    expect(readExcelTimeOfDay(t)).toBe(10 * 60 + 30);
  });

  it("combines date and time", () => {
    const base = new Date(Date.UTC(2025, 11, 18));
    const combined = combineDateAndTime(base, 8 * 60);
    expect(combined.toISOString()).toBe("2025-12-18T08:00:00.000Z");
  });
});
