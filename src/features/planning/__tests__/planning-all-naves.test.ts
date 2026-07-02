import { beforeEach, describe, expect, it, vi } from "vitest";

const { loadActiveNavesOrdered, generateGlobalPlanning } = vi.hoisted(() => ({
  loadActiveNavesOrdered: vi.fn(),
  generateGlobalPlanning: vi.fn(),
}));

const assertActiveNavesSchedulableTasksHaveOpenWorkOrder = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("@/features/naves/active-naves", () => ({
  loadActiveNavesOrdered,
}));

const assertSchedulableTransportTasksHaveOperators = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

const getPriorPlanningAssignments = vi.hoisted(() => vi.fn().mockResolvedValue([]));

vi.mock("@/features/work-orders/require-for-planning", () => ({
  assertActiveNavesSchedulableTasksHaveOpenWorkOrder,
}));

vi.mock("@/features/projects/transport-operators", () => ({
  assertSchedulableTransportTasksHaveOperators,
}));

vi.mock("@/features/planning/prior-week-planning", () => ({
  getPriorPlanningAssignments,
}));

vi.mock("@/features/planning/service", () => ({
  generateGlobalPlanning,
}));

import { generatePlanningAllNaves } from "@/features/planning/planning-all-naves";

describe("generatePlanningAllNaves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadActiveNavesOrdered.mockResolvedValue([
      { id: "nave-b", codigo: "B", nombre: "Nave B" },
      { id: "nave-a", codigo: "A", nombre: "Nave A" },
    ]);
    generateGlobalPlanning.mockResolvedValue({
      perNave: [
        {
          planningId: "plan-b",
          naveId: "nave-b",
          naveCodigo: "B",
          warnings: [],
          unscheduledHours: 1,
          assignmentsCount: 10,
        },
        {
          planningId: "plan-a",
          naveId: "nave-a",
          naveCodigo: "A",
          warnings: [],
          unscheduledHours: 2,
          assignmentsCount: 5,
        },
      ],
      warnings: ["warn-b", "warn-a"],
      unscheduledHours: 3,
      assignmentsCount: 15,
      planningIds: ["plan-b", "plan-a"],
    });
  });

  it("runs one unified solver for all active naves", async () => {
    const weekStart = new Date("2026-06-01T00:00:00.000Z");
    const result = await generatePlanningAllNaves({ weekStart });

    expect(assertActiveNavesSchedulableTasksHaveOpenWorkOrder).toHaveBeenCalledTimes(1);
    expect(assertSchedulableTransportTasksHaveOperators).toHaveBeenCalledTimes(1);
    expect(generateGlobalPlanning).toHaveBeenCalledTimes(1);
    expect(generateGlobalPlanning).toHaveBeenCalledWith({
      weekStart,
      replaceDraft: undefined,
      planFrom: undefined,
      planFromAt: undefined,
      naves: [
        { id: "nave-b", codigo: "B" },
        { id: "nave-a", codigo: "A" },
      ],
    });

    expect(result.perNave.map((row) => row.naveCodigo)).toEqual(["B", "A"]);
    expect(result.planningIds).toEqual(["plan-b", "plan-a"]);
    expect(result.warnings).toEqual(["warn-b", "warn-a"]);
    expect(result.unscheduledHours).toBe(3);
    expect(result.assignmentsCount).toBe(15);
  });
});
