import { describe, expect, it } from "vitest";
import {
  extractIfErrorStringFallback,
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

  it("reads IFERROR fallback when formula result is invalid", () => {
    expect(
      extractIfErrorStringFallback(
        'IFERROR(__xludf.DUMMYFUNCTION("""COMPUTED_VALUE"""),"Ensamblaje")',
      ),
    ).toBe("Ensamblaje");
    expect(
      readMappedTextCell({
        formula: 'IFERROR(__xludf.DUMMYFUNCTION("FILTER(BBDD!I:I,BBDD!G:G=C8)"),"CNC")',
        result: new Date(Number.NaN),
      }),
    ).toBe("CNC");
  });
});
