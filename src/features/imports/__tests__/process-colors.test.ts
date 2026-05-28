import { describe, expect, it } from "vitest";
import { processColorsForCode } from "@/lib/color";

describe("processColorsForCode", () => {
  it("returns stable colors per code", () => {
    const a = processColorsForCode("CNC");
    const b = processColorsForCode("CNC");
    expect(a).toEqual(b);
    expect(a.fgColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("can differ between codes", () => {
    const a = processColorsForCode("CNC");
    const b = processColorsForCode("PINTURA");
    expect(a.fgColor).not.toBe(b.fgColor);
  });
});
