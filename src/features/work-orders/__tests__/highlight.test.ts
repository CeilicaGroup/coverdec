import { describe, expect, it } from "vitest";
import { WO_HIGHLIGHT_TARGET, withWorkOrderHighlight } from "../highlight";

describe("withWorkOrderHighlight", () => {
  it("returns highlight attrs when work order number is set", () => {
    expect(withWorkOrderHighlight("OT0001-2026", "row")).toEqual({
      className: `row ${WO_HIGHLIGHT_TARGET}`,
      "data-work-order": "OT0001-2026",
    });
  });

  it("returns only className when number is missing", () => {
    expect(withWorkOrderHighlight(null, "row")).toEqual({ className: "row" });
  });
});
