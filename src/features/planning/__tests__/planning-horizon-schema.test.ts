import { describe, expect, it } from "vitest";
import {
  parseHorizonModeInput,
  planningHorizonModeSchema,
} from "@/features/planning/planning-horizon-schema";

describe("planning-horizon-schema", () => {
  it("accepts WEEK mode", () => {
    expect(planningHorizonModeSchema.parse({ kind: "WEEK" })).toEqual({ kind: "WEEK" });
  });

  it("PROJECT requires projectId", () => {
    expect(() => planningHorizonModeSchema.parse({ kind: "PROJECT" })).toThrow();
    expect(
      planningHorizonModeSchema.parse({ kind: "PROJECT", projectId: "abc" }),
    ).toEqual({ kind: "PROJECT", projectId: "abc" });
  });

  it("UNTIL_DATE requires untilIso", () => {
    expect(() => planningHorizonModeSchema.parse({ kind: "UNTIL_DATE" })).toThrow();
    expect(
      planningHorizonModeSchema.parse({ kind: "UNTIL_DATE", untilIso: "2026-06-30" }),
    ).toEqual({ kind: "UNTIL_DATE", untilIso: "2026-06-30" });
  });

  it("parseHorizonModeInput maps client payload", () => {
    expect(
      parseHorizonModeInput({ kind: "MONTH" }),
    ).toEqual({ kind: "MONTH" });
  });
});
