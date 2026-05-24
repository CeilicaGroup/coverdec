import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callPlanningSolver } from "../client";
import { defaultWeeklyTemplate } from "../slots/person-schedule";
import { minimalSolverInput } from "./solver-fixtures";

function minimalInput() {
  return minimalSolverInput({
    processes: [{ code: "CNC", waitHours: 0 }],
    people: [
      {
        id: "p1",
        iniciales: "AB",
        primary: ["CNC"],
        fallback: [],
        capacityHours: 8,
        hourlyRate: 10,
        overtimeHourlyRate: 15,
      },
    ],
    tasks: [
      {
        id: "t1",
        projectId: "pr1",
        projectPriority: 1,
        projectDeliveryDate: null,
        lampId: "l1",
        order: 0,
        process: "CNC",
        pendingHours: 2,
      },
    ],
    weeklyByPerson: new Map([["p1", defaultWeeklyTemplate()]]),
  });
}

describe("callPlanningSolver", () => {
  const originalUrl = process.env.PLANNING_SOLVER_URL;

  beforeEach(() => {
    process.env.PLANNING_SOLVER_URL = "http://solver.test";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalUrl === undefined) {
      delete process.env.PLANNING_SOLVER_URL;
    } else {
      process.env.PLANNING_SOLVER_URL = originalUrl;
    }
  });

  it("POSTs serialized input and parses assignments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignments: [
            {
              taskId: "t1",
              personId: "p1",
              date: "2026-05-04",
              startSlot: 0,
              endSlot: 2,
              hours: 2,
              process: "CNC",
              isAfternoon: false,
            },
          ],
          warnings: [],
          unscheduledHours: 0,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callPlanningSolver(minimalInput());

    expect(fetchMock).toHaveBeenCalledWith(
      "http://solver.test/solve",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0]?.hours).toBe(2);
  });
});
