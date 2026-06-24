import { DEFAULT_PLANNING_WEIGHTS } from "@/features/planning/policy-schema";
import type { SolverInput } from "../solver-types";
import type { EnginePerson, EngineTask } from "../types";

const WEEK_START = new Date("2026-05-04T00:00:00.000Z");

export const TEST_NAVE_ID = "nave-test";

export function testPerson(
  overrides: Partial<EnginePerson> & Pick<EnginePerson, "id">,
): EnginePerson {
  return {
    iniciales: overrides.id.toUpperCase(),
    primary: [],
    fallback: [],
    naveIds: [TEST_NAVE_ID],
    capacityHours: 8,
    hourlyRate: 10,
    overtimeHourlyRate: 15,
    ...overrides,
  };
}

export function testTask(
  overrides: Partial<EngineTask> & Pick<EngineTask, "id">,
): EngineTask {
  return {
    projectId: "pr1",
    projectPriority: 50,
    deadlineCurveExponent: 2,
    overduePenaltyMultiplier: 2.5,
    projectDeliveryDate: null,
    lampId: "l1",
    lampElementId: null,
    elementTypeId: null,
    order: 0,
    process: "CNC",
    naveId: TEST_NAVE_ID,
    pendingHours: 4,
    ...overrides,
  };
}

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
    busySlots: [],
    ...overrides,
  };
}
