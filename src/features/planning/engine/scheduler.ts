import type {
  EngineAssignment,
  EngineHoliday,
  EngineInput,
  EnginePerson,
  EngineProcessDef,
  EngineResult,
  EngineTask,
  EngineWarning,
} from "./types";
import {
  AFTERNOON_END,
  AFTERNOON_START,
  MORNING_END,
  MORNING_START,
  WORKDAY_HOURS,
} from "./types";
import type { ProcessCode } from "@/generated/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return toUtcDay(a).getTime() === toUtcDay(b).getTime();
}

/**
 * Greedy deterministic scheduler (not a CSP/ILP solver).
 * Strategy: sort tasks by (deliveryDate asc, projectPriority asc, process sequence asc),
 * then assign hours day-by-day. Among eligible people for a process, picks whoever has
 * the least total hours already assigned in the week (tie-break: personId) so load
 * spreads across peers with the same primary/fallback tier.
 * See docs/architecture.md § Motor de planning.
 */
export function runScheduler(input: EngineInput): EngineResult {
  const weekStart = toUtcDay(input.weekStart);
  const days: Date[] = Array.from({ length: 5 }, (_, i) =>
    addUtcDays(weekStart, i),
  );

  const capacity = buildCapacityMap(days, input.people, input.absences, input.holidays);
  const processIndex = buildProcessIndex(input.processes);

  const sortedTasks = sortTasks(input.tasks, processIndex);
  const assignments: EngineAssignment[] = [];
  const warnings: EngineWarning[] = [];
  const lampProgress = new Map<string, number>();
  const weeklyHoursAssigned = new Map<string, number>();
  for (const p of input.people) {
    weeklyHoursAssigned.set(p.id, 0);
  }

  for (const task of sortedTasks) {
    const remainingByLamp = lampProgress.get(task.lampId ?? task.id) ?? 0;
    let remaining = task.pendingHours;
    if (remaining <= 0) continue;

    const def = processIndex.get(task.process);
    if (!def) {
      warnings.push({ taskId: task.id, reason: `Proceso ${task.process} sin definición` });
      continue;
    }

    const candidates = pickCandidates(input.people, task.process);
    if (candidates.length === 0) {
      warnings.push({
        taskId: task.id,
        reason: `Sin operario disponible para ${task.process}`,
      });
      continue;
    }

    let scheduled = 0;
    for (const day of days) {
      if (remaining <= 0.001) break;
      const dayOfWeek = mondayBasedDay(day);
      if (def.deadlineDay && dayOfWeek > def.deadlineDay) break;

      while (remaining > 0.001) {
        const eligible = candidates.filter(
          (person) => capacity.getFree(person.id, day) > 0.001,
        );
        if (eligible.length === 0) break;

        eligible.sort((a, b) => {
          const ha = weeklyHoursAssigned.get(a.id) ?? 0;
          const hb = weeklyHoursAssigned.get(b.id) ?? 0;
          if (ha !== hb) return ha - hb;
          return a.id.localeCompare(b.id);
        });

        const person = eligible[0];
        const free = capacity.getFree(person.id, day);
        const take = Math.min(free, remaining);
        const { startSlot, endSlot, isAfternoon } = capacity.consume(
          person.id,
          day,
          take,
        );
        assignments.push({
          taskId: task.id,
          personId: person.id,
          date: day,
          startSlot,
          endSlot,
          hours: take,
          process: task.process,
          isAfternoon,
        });
        weeklyHoursAssigned.set(
          person.id,
          (weeklyHoursAssigned.get(person.id) ?? 0) + take,
        );
        scheduled += take;
        remaining -= take;
      }
    }

    if (remaining > 0.001) {
      warnings.push({
        taskId: task.id,
        reason: `Quedan ${remaining.toFixed(2)}h sin asignar`,
      });
    }
    lampProgress.set(task.lampId ?? task.id, remainingByLamp + scheduled);
  }

  const unscheduledHours = warnings.reduce((acc, w) => {
    const match = /Quedan ([\d.]+)h/.exec(w.reason);
    return acc + (match ? Number(match[1]) : 0);
  }, 0);

  return { assignments, warnings, unscheduledHours };
}

function sortTasks(
  tasks: EngineTask[],
  processIndex: Map<ProcessCode, EngineProcessDef>,
): EngineTask[] {
  return [...tasks].sort((a, b) => {
    const dateA = a.projectDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const dateB = b.projectDeliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (dateA !== dateB) return dateA - dateB;
    if (a.projectPriority !== b.projectPriority) {
      return a.projectPriority - b.projectPriority;
    }
    const seqA = processIndex.get(a.process)?.sequence ?? 99;
    const seqB = processIndex.get(b.process)?.sequence ?? 99;
    return seqA - seqB;
  });
}

function buildProcessIndex(
  processes: EngineProcessDef[],
): Map<ProcessCode, EngineProcessDef> {
  return new Map(processes.map((p) => [p.code, p]));
}

function pickCandidates(
  people: EnginePerson[],
  process: ProcessCode,
): EnginePerson[] {
  const primary = people.filter((p) => p.primary.includes(process));
  if (primary.length > 0) return primary;
  return people.filter((p) => p.fallback.includes(process));
}

function mondayBasedDay(date: Date): number {
  const dow = toUtcDay(date).getUTCDay();
  return dow === 0 ? 7 : dow;
}

interface CapacityMap {
  getFree: (personId: string, day: Date) => number;
  consume: (
    personId: string,
    day: Date,
    hours: number,
  ) => { startSlot: number; endSlot: number; isAfternoon: boolean };
}

function buildCapacityMap(
  days: Date[],
  people: EnginePerson[],
  absences: { personId: string; date: Date; hours: number }[],
  holidays: EngineHoliday[],
): CapacityMap {
  const keyOf = (id: string, day: Date): string => `${id}|${day.toISOString()}`;
  const cursor = new Map<string, number>();
  const max = new Map<string, number>();

  for (const day of days) {
    const isHoliday = holidays.some((h) => isSameUtcDay(h.date, day));
    for (const person of people) {
      const k = keyOf(person.id, day);
      const absence = absences.find(
        (a) => a.personId === person.id && isSameUtcDay(a.date, day),
      );
      const cap = isHoliday
        ? 0
        : Math.max(0, (person.capacityHours ?? WORKDAY_HOURS) - (absence?.hours ?? 0));
      max.set(k, cap);
      cursor.set(k, 0);
    }
  }

  return {
    getFree: (personId, day) => {
      const k = keyOf(personId, day);
      return (max.get(k) ?? 0) - (cursor.get(k) ?? 0);
    },
    consume: (personId, day, hours) => {
      const k = keyOf(personId, day);
      const used = cursor.get(k) ?? 0;
      const startSlot = used;
      const endSlot = used + hours;
      cursor.set(k, endSlot);
      const isAfternoon = startSlot >= MORNING_END - MORNING_START;
      return { startSlot, endSlot, isAfternoon };
    },
  };
}

export const __test__ = {
  mondayBasedDay,
  pickCandidates,
  AFTERNOON_END,
  AFTERNOON_START,
};
