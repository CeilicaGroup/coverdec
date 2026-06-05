import { describe, expect, it } from "vitest";
import { isManualEstimateLamp } from "@/lib/manual-lamp";

describe("isManualEstimateLamp", () => {
  it("detects lamps without catalog element type", () => {
    expect(
      isManualEstimateLamp({
        elementTypeId: null,
        tasks: [],
      }),
    ).toBe(true);
  });

  it("detects lamps with manual estimation task", () => {
    expect(
      isManualEstimateLamp({
        elementTypeId: "element-1",
        tasks: [{ process: "ESTIMACION_MANUAL" }],
      }),
    ).toBe(true);
  });

  it("returns false for catalog lamps", () => {
    expect(
      isManualEstimateLamp({
        elementTypeId: "element-1",
        tasks: [{ process: "CNC" }],
      }),
    ).toBe(false);
  });
});
