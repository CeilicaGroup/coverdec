import { describe, expect, it } from "vitest";
import { defaultWeeklyTemplate } from "../slots/person-schedule";
import { minimalSolverInput } from "./solver-fixtures";
import {
  parseSolverResponse,
  serializeSolverInput,
  type SolverInput,
} from "../solver-types";

describe("serializeSolverInput", () => {
  it("converts Maps to JSON-friendly schedules and previousHours", () => {
    const weekly = defaultWeeklyTemplate();
    const input: SolverInput = minimalSolverInput({
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
      weeklyByPerson: new Map([["p1", weekly]]),
      previousHours: new Map([["t1|p1|0", 2]]),
    });

    const payload = serializeSolverInput(input);
    expect(payload.weekStart).toBe("2026-05-04");
    expect(payload.schedules).toHaveLength(1);
    expect(payload.schedules[0]?.personId).toBe("p1");
    expect(payload.schedules[0]?.weekly).toHaveLength(5);
    expect(payload.previousHours).toEqual([{ key: "t1|p1|0", quarters: 8 }]);
  });

  it("serializes extended process codes without coercion", () => {
    const input: SolverInput = minimalSolverInput({
      processes: [
        { code: "PERFILES", waitHours: 0 },
        { code: "EMBALAJE", waitHours: 0 },
      ],
      people: [
        {
          id: "p1",
          iniciales: "AB",
          primary: ["PERFILES", "EMBALAJE"],
          fallback: ["LIMPIEZA"],
          capacityHours: 8,
          hourlyRate: 10,
          overtimeHourlyRate: 15,
        },
      ],
      tasks: [
        {
          id: "t1",
          projectId: "pr1",
          projectPriority: 60,
          deadlineCurveExponent: 2,
          overduePenaltyMultiplier: 2.5,
          projectDeliveryDate: null,
          lampId: "l1",
          order: 0,
          process: "PERFILES",
          pendingHours: 4,
        },
      ],
    });

    const payload = serializeSolverInput(input);
    expect(payload.processes.map((p) => p.code)).toEqual(["PERFILES", "EMBALAJE"]);
    expect(payload.tasks[0]?.process).toBe("PERFILES");
    expect(payload.people[0]?.primary).toEqual(["PERFILES", "EMBALAJE"]);
  });

  it("serializes waitHours on processes", () => {
    const input: SolverInput = minimalSolverInput({
      processes: [{ code: "IMPRIMACION", waitHours: 12 }],
    });
    const payload = serializeSolverInput(input);
    expect(payload.processes[0]?.waitHours).toBe(12);
  });

  it("includes all people in schedules even without workWindows", () => {
    const person = (id: string) => ({
      id,
      iniciales: id.toUpperCase(),
      primary: ["CNC"],
      fallback: [],
      capacityHours: 8,
      hourlyRate: 10,
      overtimeHourlyRate: 15,
    });
    const input: SolverInput = minimalSolverInput({
      people: [person("p1"), person("p2"), person("p3")],
      // p1 has a custom schedule, p2 and p3 have nothing
      weeklyByPerson: new Map([["p1", defaultWeeklyTemplate()]]),
    });

    const payload = serializeSolverInput(input);
    const ids = payload.schedules.map((s) => s.personId).sort();
    expect(ids).toEqual(["p1", "p2", "p3"]);
  });
});

describe("parseSolverResponse", () => {
  it("parses assignment dates as UTC midnight", () => {
    const result = parseSolverResponse({
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
    });
    expect(result.assignments[0]?.date.toISOString()).toBe(
      "2026-05-04T00:00:00.000Z",
    );
  });
});
