import { describe, expect, it } from "vitest";
import {
  summarizeSolverRequest,
  type SolveRequestPayload,
} from "../solver-types";

describe("summarizeSolverRequest", () => {
  it("aggregates pending hours and booked capacity", () => {
    const payload: SolveRequestPayload = {
      weekStart: "2026-05-25",
      processes: [{ code: "CNC", waitHours: 0 }],
      people: [
        {
          id: "p1",
          iniciales: "IA",
          primary: ["Ensamblaje"],
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
          projectPriority: 50,
          deadlineCurveExponent: 2,
          overduePenaltyMultiplier: 2,
          projectDeliveryDate: null,
          lampId: "l1",
          order: 0,
          process: "Ensamblaje",
          pendingHours: 4,
          minWeekQuarter: 0,
        },
      ],
      absences: [],
      holidays: [],
      weights: {
        wPriority: 1,
        wLate: 1,
        wUnscheduled: 1,
        wLoadBalance: 0,
        wMove: 0,
        wLaborCost: 0,
      },
      schedules: [],
      previousHours: [],
      firstSchedulableDayIndex: 0,
      fixedAssignments: [],
      bookedHours: [{ personId: "p1", date: "2026-05-25", hours: 6 }],
      busySlots: [],
    };

    const summary = summarizeSolverRequest(payload);
    expect(summary.totalPendingHours).toBe(4);
    expect(summary.bookedHoursTotal).toBe(6);
    expect(summary.bookedByPersonDay).toEqual({ "p1|2026-05-25": 6 });
  });
});
