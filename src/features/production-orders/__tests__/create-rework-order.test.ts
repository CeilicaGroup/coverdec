import { describe, expect, it } from "vitest";
import { ProductionOrderStatus } from "@/generated/prisma";
import {
  assertCanCreateReworkFromStatus,
  formatReworkOrderNumber,
} from "../create-rework-order";

describe("create-rework-order", () => {
  it("formats ORT number with padded serial", () => {
    expect(formatReworkOrderNumber(2026, 7)).toBe("ORT-2026-0007");
  });

  it("allows rework from in-progress or closed parent", () => {
    expect(() =>
      assertCanCreateReworkFromStatus(ProductionOrderStatus.CURSO),
    ).not.toThrow();
    expect(() =>
      assertCanCreateReworkFromStatus(ProductionOrderStatus.CERR),
    ).not.toThrow();
  });

  it("rejects rework from pending parent", () => {
    expect(() =>
      assertCanCreateReworkFromStatus(ProductionOrderStatus.PEND),
    ).toThrow(/retrabajo/);
  });
});
