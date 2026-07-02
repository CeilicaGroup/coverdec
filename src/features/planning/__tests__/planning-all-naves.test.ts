import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadActiveNavesOrdered, generatePlanning } = vi.hoisted(() => ({
  loadActiveNavesOrdered: vi.fn(),
  generatePlanning: vi.fn(),
}));

const assertActiveNavesSchedulableTasksHaveOpenWorkOrder = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("@/features/naves/active-naves", () => ({
  loadActiveNavesOrdered,
}));

vi.mock("@/features/work-orders/require-for-planning", () => ({
  assertActiveNavesSchedulableTasksHaveOpenWorkOrder,
}));

vi.mock("@/features/planning/service", () => ({
  generatePlanning,
}));

import { generatePlanningAllNaves } from "@/features/planning/planning-all-naves";

describe("generatePlanningAllNaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadActiveNavesOrdered.mockResolvedValue([
      { id: "nave-b", codigo: "B", nombre: "Nave B" },
      { id: "nave-a", codigo: "A", nombre: "Nave A" },
    ]);
    generatePlanning
      .mockResolvedValueOnce({
        planningId: "plan-b",
        warnings: ["warn-b"],
        unscheduledHours: 1,
        assignmentsCount: 10,
      })
      .mockResolvedValueOnce({
        planningId: "plan-a",
        warnings: ["warn-a"],
        unscheduledHours: 2,
        assignmentsCount: 5,
      });
  });

  it("generates plannings in nave codigo order", async () => {
    const weekStart = new Date("2026-06-01T00:00:00.000Z");
    const result = await generatePlanningAllNaves({ weekStart });

    expect(assertActiveNavesSchedulableTasksHaveOpenWorkOrder).toHaveBeenCalledTimes(1);
    expect(generatePlanning).toHaveBeenCalledTimes(2);
    expect(generatePlanning.mock.calls[0]?.[0]).toMatchObject({ naveId: "nave-b" });
    expect(generatePlanning.mock.calls[1]?.[0]).toMatchObject({ naveId: "nave-a" });

    expect(result.perNave.map((row) => row.naveCodigo)).toEqual(["B", "A"]);
    expect(result.planningIds).toEqual(["plan-b", "plan-a"]);
    expect(result.warnings).toEqual(["warn-b", "warn-a"]);
    expect(result.unscheduledHours).toBe(3);
    expect(result.assignmentsCount).toBe(15);
  });
});
