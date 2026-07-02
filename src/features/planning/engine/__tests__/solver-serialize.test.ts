import { describe, expect, it } from "vitest";
import { defaultWeeklyTemplate } from "../slots/person-schedule";
import { minimalSolverInput, testPerson, testTask } from "./solver-fixtures";
import {
  parseSolverResponse,
  serializeSolverInput,
  type SolverInput,
} from "../solver-types";

describe("serializeSolverInput", () => {
  it("converts Maps to JSON-friendly schedules and previousHours", () => {
    const weekly = defaultWeeklyTemplate();
    const input: SolverInput = minimalSolverInput({
      people: [testPerson({ id: "p1", primary: ["CNC"] })],
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
        testPerson({
          id: "p1",
          primary: ["PERFILES", "EMBALAJE"],
          fallback: ["LIMPIEZA"],
        }),
      ],
      tasks: [
        testTask({
          id: "t1",
          projectPriority: 60,
          process: "PERFILES",
          pendingHours: 4,
        }),
      ],
    });

    const payload = serializeSolverInput(input);
    expect(payload.processes.map((p) => p.code)).toEqual(["PERFILES", "EMBALAJE"]);
    expect(payload.tasks[0]?.process).toBe("PERFILES");
    expect(payload.people[0]?.primary).toEqual(["PERFILES", "EMBALAJE"]);
    expect(payload.tasks[0]?.naveId).toBeTruthy();
    expect(payload.people[0]?.naveId).toBeTruthy();
  });

  it("serializes waitHours on processes", () => {
    const input: SolverInput = minimalSolverInput({
      processes: [{ code: "IMPRIMACION", waitHours: 12 }],
    });
    const payload = serializeSolverInput(input);
    expect(payload.processes[0]?.waitHours).toBe(12);
  });

  it("serializes canFragment and ownerPersonId on tasks", () => {
    const input: SolverInput = minimalSolverInput({
      tasks: [
        testTask({
          id: "t1",
          process: "ENSAMBLAJE",
          pendingHours: 6,
          canFragment: false,
          ownerPersonId: "p1",
        }),
      ],
    });

    const payload = serializeSolverInput(input);
    expect(payload.tasks[0]?.canFragment).toBe(false);
    expect(payload.tasks[0]?.ownerPersonId).toBe("p1");
  });

  it("serializes lampElementId on tasks", () => {
    const input: SolverInput = minimalSolverInput({
      tasks: [
        testTask({
          id: "t1",
          lampElementId: "elem-1",
          pendingHours: 4,
        }),
      ],
    });

    const payload = serializeSolverInput(input);
    expect(payload.tasks[0]?.lampElementId).toBe("elem-1");
  });

  it("defaults canFragment to true and ownerPersonId to null", () => {
    const input: SolverInput = minimalSolverInput({
      tasks: [testTask({ id: "t1", pendingHours: 4 })],
    });

    const payload = serializeSolverInput(input);
    expect(payload.tasks[0]?.canFragment).toBe(true);
    expect(payload.tasks[0]?.ownerPersonId).toBeNull();
    expect(payload.tasks[0]?.workOrderId).toBeNull();
    expect(payload.tasks[0]?.workOrderSequence).toBeNull();
  });

  it("serializes workOrderId and workOrderSequence on tasks", () => {
    const input: SolverInput = minimalSolverInput({
      tasks: [
        testTask({
          id: "t1",
          pendingHours: 4,
          workOrderId: "wo-1",
          workOrderSequence: 2,
        }),
      ],
    });

    const payload = serializeSolverInput(input);
    expect(payload.tasks[0]?.workOrderId).toBe("wo-1");
    expect(payload.tasks[0]?.workOrderSequence).toBe(2);
  });

  it("includes all people in schedules even without workWindows", () => {
    const input: SolverInput = minimalSolverInput({
      people: [
        testPerson({ id: "p1" }),
        testPerson({ id: "p2" }),
        testPerson({ id: "p3" }),
      ],
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
