import { describe, expect, it } from "vitest";
import { LampElementStockStatus } from "@/generated/prisma";
import {
  computeNextSlotForPersonDay,
  formatStockBatchCode,
  lampAssignFromStockFields,
  lampReturnToStockFields,
  parseStockBatchSerial,
  stockElementStatusForAssign,
  stockElementStatusForProduction,
  stockElementStatusForReturn,
} from "../move-lamp";

describe("move-lamp helpers", () => {
  it("formats and parses stock batch codes", () => {
    const code = formatStockBatchCode(2026, 7);
    expect(code).toBe("SB-0007-2026");
    expect(parseStockBatchSerial(code, 2026)).toBe(7);
    expect(parseStockBatchSerial("SB-0001-2025", 2026)).toBeNull();
  });

  it("builds return and assign field payloads", () => {
    const returned = lampReturnToStockFields({
      previousProjectId: "proj-1",
      reason: "  revisión  ",
    });
    expect(returned.previousProjectId).toBe("proj-1");
    expect(returned.returnedToStockReason).toBe("revisión");
    expect(returned.returnedToStockAt).toBeInstanceOf(Date);

    expect(lampAssignFromStockFields()).toEqual({
      returnedToStockAt: null,
      returnedToStockReason: null,
      previousProjectId: null,
    });
  });

  it("maps stock element statuses", () => {
    expect(stockElementStatusForReturn()).toBe(LampElementStockStatus.AVAILABLE);
    expect(stockElementStatusForAssign()).toBe(LampElementStockStatus.ASSIGNED);
    expect(stockElementStatusForProduction()).toBe(
      LampElementStockStatus.IN_PRODUCTION,
    );
  });

  it("computes next slot after existing assignments", () => {
    expect(computeNextSlotForPersonDay([], 2)).toEqual({
      startSlot: 0,
      endSlot: 2,
      isAfternoon: false,
    });
    expect(computeNextSlotForPersonDay([4, 5.5], 1.5)).toEqual({
      startSlot: 5.5,
      endSlot: 7,
      isAfternoon: false,
    });
    expect(computeNextSlotForPersonDay([6], 1)).toEqual({
      startSlot: 6,
      endSlot: 7,
      isAfternoon: true,
    });
  });
});
