import type { EngineAssignment } from "@/features/planning/engine/types";

export interface OverrideAssignmentSlice {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
  isAfternoon: boolean;
}

export function filterOverrideAssignments<
  T extends { isOverride: boolean },
>(assignments: T[]): T[] {
  return assignments.filter((assignment) => assignment.isOverride);
}

export function mergeOverrideAssignmentsAfterSolver(
  overrideAssignments: OverrideAssignmentSlice[],
  solverAssignments: EngineAssignment[],
): EngineAssignment[] {
  const overrideTaskIds = new Set(
    overrideAssignments.map((assignment) => assignment.taskId),
  );
  const filtered = solverAssignments.filter(
    (assignment) => !overrideTaskIds.has(assignment.taskId),
  );
  return [
    ...filtered,
    ...overrideAssignments.map((assignment) => ({
      taskId: assignment.taskId,
      personId: assignment.personId,
      date: assignment.date,
      startSlot: assignment.startSlot,
      endSlot: assignment.endSlot,
      hours: assignment.hours,
      process: assignment.process,
      isAfternoon: assignment.isAfternoon,
    })),
  ];
}
