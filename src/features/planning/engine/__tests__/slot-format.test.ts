import { describe, expect, it } from "vitest";
import {
  rangeLabel,
  slotEndLabel,
  slotToLabel,
} from "../slot-format";

describe("slotToLabel (start position)", () => {
  it("slot 0 → 8h", () => expect(slotToLabel(0)).toBe("8h"));
  it("slot 6 → 15h (start of afternoon)", () => expect(slotToLabel(6)).toBe("15h"));
  it("slot 8 → 17h", () => expect(slotToLabel(8)).toBe("17h"));
  it("slot 3.5 → 11.5h", () => expect(slotToLabel(3.5)).toBe("11.5h"));
});

describe("slotEndLabel (end position)", () => {
  it("slot 6 → 14h (end of morning, not start of afternoon)", () =>
    expect(slotEndLabel(6)).toBe("14h"));
  it("slot 0 → 8h", () => expect(slotEndLabel(0)).toBe("8h"));
  it("slot 3 → 11h", () => expect(slotEndLabel(3)).toBe("11h"));
  it("slot 6.5 → 15.5h (into afternoon)", () => expect(slotEndLabel(6.5)).toBe("15.5h"));
  it("slot 8 → 17h", () => expect(slotEndLabel(8)).toBe("17h"));
});

describe("rangeLabel", () => {
  it("morning-only task 8h–14h (slots 0–6)", () =>
    expect(rangeLabel(0, 6)).toBe("8h–14h"));
  it("afternoon-spanning task 11.5h–15.5h (slots 3.5–6.5)", () =>
    expect(rangeLabel(3.5, 6.5)).toBe("11.5h–15.5h"));
  it("afternoon task 15h–17h (slots 6–8)", () =>
    expect(rangeLabel(6, 8)).toBe("15h–17h"));
  it("short morning task 8h–11h (slots 0–3)", () =>
    expect(rangeLabel(0, 3)).toBe("8h–11h"));
});
