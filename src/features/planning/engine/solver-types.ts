import { z } from "zod";
import type { PlanningWeights } from "@/features/planning/policy-schema";
import type { PlanFrom } from "@/features/planning/plan-from";
import type {
  EngineBookedHours,
  EngineBusySlot,
  EngineFixedAssignment,
  EngineInput,
  EngineResult,
} from "./types";
import type {
  PersonScheduleDayInput,
  PersonScheduleOverrideInput,
} from "./slots/person-schedule";

export interface DeferredPlanningTask {
  taskId: string;
  hours: number;
}

export interface SolverInput extends EngineInput {
  weights: PlanningWeights;
  weeklyByPerson: Map<string, PersonScheduleDayInput[]>;
  overridesByPerson: Map<string, PersonScheduleOverrideInput[]>;
  previousHours?: Map<string, number>;
  firstSchedulableDayIndex: number;
  firstSchedulableWeekQuarter?: number;
  fixedAssignments: EngineFixedAssignment[];
  bookedHours: EngineBookedHours[];
  busySlots: EngineBusySlot[];
  planFrom?: PlanFrom;
  /** Tareas que no pueden empezar en esta semana (secado / cadena). */
  deferredTasks?: DeferredPlanningTask[];
}

const processCodeSchema = z.string();

export type SolveRequestPayload = {
  weekStart: string;
  processes: {
    code: string;
    waitHours: number;
  }[];
  people: SolverInput["people"];
  tasks: {
    id: string;
    projectId: string;
    projectPriority: number;
    deadlineCurveExponent: number;
    overduePenaltyMultiplier: number;
    projectDeliveryDate: string | null;
    lampId: string;
    order: number;
    process: string;
    pendingHours: number;
  }[];
  absences: {
    personId: string;
    date: string;
    hours: number;
    blockStartMinutes?: number | null;
    blockEndMinutes?: number | null;
  }[];
  holidays: { date: string }[];
  weights: SolverInput["weights"];
  schedules: {
    personId: string;
    weekly: PersonScheduleDayInput[];
    overrides: { date: string; windows: { startMinutes: number; endMinutes: number }[] }[];
  }[];
  previousHours: { key: string; quarters: number }[];
  firstSchedulableDayIndex: number;
  firstSchedulableWeekQuarter?: number;
  fixedAssignments: {
    taskId: string;
    personId: string;
    date: string;
    startSlot: number;
    endSlot: number;
    hours: number;
    process: string;
  }[];
  bookedHours: { personId: string; date: string; hours: number }[];
  busySlots: {
    personId: string;
    date: string;
    startSlot: number;
    endSlot: number;
    hours: number;
  }[];
};

const solveResponseSchema = z.object({
  assignments: z.array(
    z.object({
      taskId: z.string(),
      personId: z.string(),
      date: z.string(),
      startSlot: z.number(),
      endSlot: z.number(),
      hours: z.number(),
      process: processCodeSchema,
      isAfternoon: z.boolean(),
    }),
  ),
  warnings: z.array(
    z.object({
      taskId: z.string(),
      reason: z.string(),
    }),
  ),
  unscheduledHours: z.number(),
});

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function serializeSolverInput(input: SolverInput): SolveRequestPayload {
  const schedules = [...input.weeklyByPerson.entries()].map(
    ([personId, weekly]) => ({
      personId,
      weekly,
      overrides: (input.overridesByPerson.get(personId) ?? []).map((o) => ({
        date: toIsoDate(o.date),
        windows: o.windows,
      })),
    }),
  );

  for (const [personId, overrides] of input.overridesByPerson.entries()) {
    if (input.weeklyByPerson.has(personId)) continue;
    schedules.push({
      personId,
      weekly: [],
      overrides: overrides.map((o) => ({
        date: toIsoDate(o.date),
        windows: o.windows,
      })),
    });
  }

  // Garantizar que todos los trabajadores tienen entrada en schedules aunque
  // no tengan workWindows ni overrides configurados en BD.
  const scheduledIds = new Set(schedules.map((s) => s.personId));
  for (const person of input.people) {
    if (!scheduledIds.has(person.id)) {
      schedules.push({ personId: person.id, weekly: [], overrides: [] });
    }
  }

  const previousHours: { key: string; quarters: number }[] = [];
  if (input.previousHours) {
    for (const [key, hours] of input.previousHours.entries()) {
      previousHours.push({
        key,
        quarters: Math.round(hours * 4),
      });
    }
  }

  return {
    weekStart: toIsoDate(input.weekStart),
    processes: input.processes.map((p) => ({
      code: p.code,
      waitHours: p.waitHours,
    })),
    people: input.people,
    tasks: input.tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      projectPriority: t.projectPriority,
      deadlineCurveExponent: t.deadlineCurveExponent,
      overduePenaltyMultiplier: t.overduePenaltyMultiplier,
      projectDeliveryDate: t.projectDeliveryDate
        ? t.projectDeliveryDate.toISOString()
        : null,
      lampId: t.lampId,
      order: t.order,
      process: t.process,
      pendingHours: t.pendingHours,
      minWeekQuarter: t.minWeekQuarter ?? 0,
    })),
    absences: input.absences.map((a) => ({
      personId: a.personId,
      date: toIsoDate(a.date),
      hours: a.hours,
      blockStartMinutes: a.blockStartMinutes ?? null,
      blockEndMinutes: a.blockEndMinutes ?? null,
    })),
    holidays: input.holidays.map((h) => ({ date: toIsoDate(h.date) })),
    weights: input.weights,
    schedules,
    previousHours,
    firstSchedulableDayIndex: input.firstSchedulableDayIndex,
    firstSchedulableWeekQuarter: input.firstSchedulableWeekQuarter,
    fixedAssignments: input.fixedAssignments.map((f) => ({
      taskId: f.taskId,
      personId: f.personId,
      date: toIsoDate(f.date),
      startSlot: f.startSlot,
      endSlot: f.endSlot,
      hours: f.hours,
      process: f.process,
    })),
    bookedHours: input.bookedHours.map((b) => ({
      personId: b.personId,
      date: toIsoDate(b.date),
      hours: b.hours,
    })),
    busySlots: input.busySlots.map((b) => ({
      personId: b.personId,
      date: toIsoDate(b.date),
      startSlot: b.startSlot,
      endSlot: b.endSlot,
      hours: b.hours,
    })),
  };
}

function parseUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function parseSolverResponse(
  raw: z.infer<typeof solveResponseSchema>,
): EngineResult {
  return {
    assignments: raw.assignments.map((a) => ({
      taskId: a.taskId,
      personId: a.personId,
      date: parseUtcDate(a.date),
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      hours: a.hours,
      process: a.process,
      isAfternoon: a.isAfternoon,
    })),
    warnings: raw.warnings,
    unscheduledHours: raw.unscheduledHours,
  };
}

export { solveResponseSchema };

export class SolverUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverUnavailableError";
  }
}

export class SolverInfeasibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SolverInfeasibleError";
  }
}
