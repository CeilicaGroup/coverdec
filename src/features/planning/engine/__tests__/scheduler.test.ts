import { describe, expect, it } from "vitest";
import { runScheduler } from "../scheduler";
import { slotToHour, slotToLabel } from "../slot-format";
import type { EngineInput } from "../types";
import { ProcessCode } from "@/generated/prisma";

const PROCESSES: EngineInput["processes"] = [
  { code: ProcessCode.CNC, sequence: 1, deadlineDay: null },
  { code: ProcessCode.ENSAMBLAJE, sequence: 2, deadlineDay: null },
  { code: ProcessCode.LIJADO, sequence: 3, deadlineDay: null },
  { code: ProcessCode.IMPRIMACION, sequence: 4, deadlineDay: 3 },
  { code: ProcessCode.PINTURA, sequence: 5, deadlineDay: 4 },
  { code: ProcessCode.PERFILES, sequence: 6, deadlineDay: 5 },
  { code: ProcessCode.EMBALAJE, sequence: 7, deadlineDay: 5 },
];

const PEOPLE: EngineInput["people"] = [
  {
    id: "claudio",
    iniciales: "CP",
    primary: [ProcessCode.PINTURA],
    fallback: [ProcessCode.LIJADO, ProcessCode.ENSAMBLAJE],
    capacityHours: 8,
  },
  {
    id: "serhii",
    iniciales: "SK",
    primary: [ProcessCode.IMPRIMACION],
    fallback: [ProcessCode.ENSAMBLAJE, ProcessCode.EMBALAJE],
    capacityHours: 8,
  },
  {
    id: "ihor",
    iniciales: "IA",
    primary: [
      ProcessCode.ENSAMBLAJE,
      ProcessCode.PERFILES,
      ProcessCode.EMBALAJE,
      ProcessCode.PEGADO_ESPEJO,
    ],
    fallback: [],
    capacityHours: 8,
  },
  {
    id: "tetiana",
    iniciales: "TM",
    primary: [ProcessCode.LIJADO],
    fallback: [],
    capacityHours: 8,
  },
  {
    id: "daniil",
    iniciales: "DS",
    primary: [ProcessCode.CNC],
    fallback: [ProcessCode.ENSAMBLAJE],
    capacityHours: 8,
  },
  {
    id: "helper-ens",
    iniciales: "HE",
    primary: [ProcessCode.ENSAMBLAJE],
    fallback: [],
    capacityHours: 8,
  },
];

const WEEK_START = new Date("2026-05-04T00:00:00Z");

describe("runScheduler", () => {
  it("assigns imprimación to Serhii on Monday-Wednesday only", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "imp-1",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.IMPRIMACION,
          pendingHours: 5,
        },
      ],
      absences: [],
      holidays: [],
    });
    expect(result.warnings).toHaveLength(0);
    expect(result.assignments.every((a) => a.personId === "serhii")).toBe(true);
    expect(result.assignments.every((a) => a.date.getUTCDay() >= 1 && a.date.getUTCDay() <= 3)).toBe(true);
  });

  it("assigns pintura to Claudio and no later than Thursday", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "pin-1",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.PINTURA,
          pendingHours: 6,
        },
      ],
      absences: [],
      holidays: [],
    });
    expect(result.assignments.every((a) => a.personId === "claudio")).toBe(true);
    expect(result.assignments.every((a) => a.date.getUTCDay() >= 1 && a.date.getUTCDay() <= 4)).toBe(true);
  });

  it("balances hours across multiple primaries for the same process", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "ens-balance",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.ENSAMBLAJE,
          pendingHours: 16,
        },
      ],
      absences: [],
      holidays: [],
    });
    expect(result.warnings).toHaveLength(0);
    const byPerson = result.assignments.reduce<Record<string, number>>((acc, a) => {
      acc[a.personId] = (acc[a.personId] ?? 0) + a.hours;
      return acc;
    }, {});
    expect(byPerson["helper-ens"]).toBeCloseTo(8, 1);
    expect(byPerson["ihor"]).toBeCloseTo(8, 1);
  });

  it("splits a task across multiple days when it exceeds daily capacity", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "lij-1",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.LIJADO,
          pendingHours: 20,
        },
      ],
      absences: [],
      holidays: [],
    });
    expect(result.assignments.length).toBeGreaterThan(1);
    const total = result.assignments.reduce((a, x) => a + x.hours, 0);
    expect(total).toBeCloseTo(20, 1);
  });

  it("excludes a person who is fully absent", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "lij-1",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.LIJADO,
          pendingHours: 8,
        },
      ],
      absences: [
        { personId: "tetiana", date: new Date("2026-05-04"), hours: 8 },
      ],
      holidays: [],
    });
    const monday = result.assignments.find(
      (a) => a.date.toISOString().startsWith("2026-05-04"),
    );
    expect(monday).toBeUndefined();
  });

  it("does not assign anything on a holiday", () => {
    const result = runScheduler({
      weekStart: WEEK_START,
      processes: PROCESSES,
      people: PEOPLE,
      tasks: [
        {
          id: "ens-1",
          projectId: "p1",
          projectPriority: 10,
          projectDeliveryDate: new Date("2026-05-15"),
          lampId: "l1",
          process: ProcessCode.ENSAMBLAJE,
          pendingHours: 8,
        },
      ],
      absences: [],
      holidays: [{ date: new Date("2026-05-04") }],
    });
    expect(
      result.assignments.some((a) =>
        a.date.toISOString().startsWith("2026-05-04"),
      ),
    ).toBe(false);
  });
});

describe("slot-format", () => {
  it("maps slot 0 to 08:00", () => {
    expect(slotToHour(0)).toBe(8);
    expect(slotToLabel(0)).toBe("08:00");
  });

  it("maps slot 6 to 15:00 (after break)", () => {
    expect(slotToHour(6)).toBe(15);
    expect(slotToLabel(6)).toBe("15:00");
  });

  it("maps slot 8 to 17:00", () => {
    expect(slotToHour(8)).toBe(17);
    expect(slotToLabel(8)).toBe("17:00");
  });
});
