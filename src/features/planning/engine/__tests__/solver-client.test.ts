import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callPlanningSolver } from "../client";
import { defaultWeeklyTemplate } from "../slots/person-schedule";
import { minimalSolverInput, testPerson, testTask } from "./solver-fixtures";

function minimalInput() {
  return minimalSolverInput({
    processes: [{ code: "CNC", waitHours: 0 }],
    people: [testPerson({ id: "p1" })],
    tasks: [testTask({ id: "t1", pendingHours: 2 })],
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

  it("returns a readable timeout error without duplicated recommendation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          assignments: [],
          warnings: [
            {
              taskId: "t1",
              reason:
                "El optimizador no encontró solución a tiempo (presupuesto 60s, estado UNKNOWN). Regenera el planning o aumenta SOLVER_MAX_SECONDS.",
            },
          ],
          unscheduledHours: 2,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(callPlanningSolver(minimalInput())).rejects.toThrow(
      "El optimizador agotó el tiempo de cálculo (60s de presupuesto). Regenera el planning o aumenta SOLVER_MAX_SECONDS en el entorno.",
    );
  });
});
