import { describe, expect, it } from "vitest";
import {
  isIsoTimestampString,
  readMappedTextCell,
} from "../excel-cell-values";

describe("excel cell values", () => {
  it("detects ISO timestamps", () => {
    expect(isIsoTimestampString("1950-01-01T00:00:00.000Z")).toBe(true);
    expect(isIsoTimestampString("YPLUS")).toBe(false);
  });

  it("ignores date cells for text fields", () => {
    expect(readMappedTextCell(new Date("1950-01-01"))).toBeNull();
    expect(readMappedTextCell("BASTIDOR DE TABICA")).toBe("BASTIDOR DE TABICA");
  });
});
