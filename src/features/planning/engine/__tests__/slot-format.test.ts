import { describe, expect, it } from "vitest";
import {
  rangeLabel,
  slotEndLabel,
  slotToLabel,
} from "../slot-format";

describe("slotToLabel (start position)", () => {
  it("slot 0 → 08:00", () => expect(slotToLabel(0)).toBe("08:00"));
  it("slot 6 → 15:00 (start of afternoon)", () => expect(slotToLabel(6)).toBe("15:00"));
  it("slot 8 → 17:00", () => expect(slotToLabel(8)).toBe("17:00"));
  it("slot 3.5 → 11:30", () => expect(slotToLabel(3.5)).toBe("11:30"));
});

describe("slotEndLabel (end position)", () => {
  it("slot 6 → 14:00 (end of morning, not start of afternoon)", () =>
    expect(slotEndLabel(6)).toBe("14:00"));
  it("slot 0 → 08:00", () => expect(slotEndLabel(0)).toBe("08:00"));
  it("slot 3 → 11:00", () => expect(slotEndLabel(3)).toBe("11:00"));
  it("slot 6.5 → 15:30 (into afternoon)", () => expect(slotEndLabel(6.5)).toBe("15:30"));
  it("slot 8 → 17:00", () => expect(slotEndLabel(8)).toBe("17:00"));
});

describe("rangeLabel", () => {
  it("morning-only task 08:00–14:00 (slots 0–6)", () =>
    expect(rangeLabel(0, 6)).toBe("08:00–14:00"));
  it("afternoon-spanning task 11:30–15:30 (slots 3.5–6.5)", () =>
    expect(rangeLabel(3.5, 6.5)).toBe("11:30–15:30"));
  it("afternoon task 15:00–17:00 (slots 6–8)", () =>
    expect(rangeLabel(6, 8)).toBe("15:00–17:00"));
  it("short morning task 08:00–11:00 (slots 0–3)", () =>
    expect(rangeLabel(0, 3)).toBe("08:00–11:00"));
});
