import { DEFAULT_PLANNING_WEIGHTS } from "@/features/planning/policy-schema";
import type { SolverInput } from "../solver-types";

const WEEK_START = new Date("2026-05-04T00:00:00.000Z");

export function minimalSolverInput(
  overrides: Partial<SolverInput> = {},
): SolverInput {
  return {
    weekStart: WEEK_START,
    processes: [],
    people: [],
    tasks: [],
    absences: [],
    holidays: [],
    weights: { ...DEFAULT_PLANNING_WEIGHTS },
    weeklyByPerson: new Map(),
    overridesByPerson: new Map(),
    firstSchedulableDayIndex: 0,
    fixedAssignments: [],
    bookedHours: [],
    ...overrides,
  };
}
