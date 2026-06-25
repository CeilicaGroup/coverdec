import { describe, expect, it } from "vitest";
import {
  distributeHoursToLines,
  eligibleLinesForHourDistribution,
  parseOrderExecutionMeta,
  serializeOrderNotes,
  assertOrderTransition,
} from "@/features/production-orders/execution";
import { ProductionOrderStatus } from "@/generated/prisma";

describe("production order execution", () => {
  it("distributes hours proportionally by units", () => {
    const map = distributeHoursToLines(
      [
        { id: "a", taskId: "t1", projectId: "p1", units: 6, ral: null },
        { id: "b", taskId: "t2", projectId: "p2", units: 4, ral: null },
      ],
      10,
    );
    expect(map.get("a")).toBe(6);
    expect(map.get("b")).toBe(4);
  });

  it("filters paint lines without RAL", () => {
    const eligible = eligibleLinesForHourDistribution(
      [
        { id: "a", taskId: "t1", projectId: "p1", units: 1, ral: null },
        { id: "b", taskId: "t2", projectId: "p2", units: 1, ral: "9005" },
      ],
      "PINTURA",
    );
    expect(eligible).toHaveLength(1);
    expect(eligible[0]!.id).toBe("b");
  });

  it("round-trips execution meta in notes", () => {
    const notes = serializeOrderNotes("Pausa por avería", { actualHours: 3.5 });
    const parsed = parseOrderExecutionMeta(notes);
    expect(parsed.userNotes).toBe("Pausa por avería");
    expect(parsed.meta.actualHours).toBe(3.5);
  });

  it("rejects invalid status transitions", () => {
    expect(() =>
      assertOrderTransition(ProductionOrderStatus.CERR, [ProductionOrderStatus.CURSO]),
    ).toThrow(/Transición no permitida/);
  });
});
