import { describe, expect, it } from "vitest";
import { formatTaskPlanningLabel } from "../format-warnings";

describe("formatTaskPlanningLabel", () => {
  it("joins project, lamp and process", () => {
    expect(
      formatTaskPlanningLabel({
        process: "Ensamblaje",
        project: { name: "DRUNI CC Splau" },
        lamp: { name: "Hair espejo caja" },
      }),
    ).toBe("DRUNI CC Splau · Hair espejo caja · Ensamblaje");
  });
});
