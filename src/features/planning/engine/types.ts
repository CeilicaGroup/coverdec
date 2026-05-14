import type { ProcessCode } from "@/generated/prisma";

export const WORKDAY_HOURS = 8;
export const MORNING_START = 8;
export const MORNING_END = 14;
export const AFTERNOON_START = 15;
export const AFTERNOON_END = 17;

export interface EngineProcessDef {
  code: ProcessCode;
  sequence: number;
  /** Day of week (1=Monday … 5=Friday) after which the process cannot run. */
  deadlineDay: number | null;
}

export interface EnginePerson {
  id: string;
  iniciales: string;
  primary: ProcessCode[];
  fallback: ProcessCode[];
  capacityHours: number;
}

export interface EngineTask {
  id: string;
  projectId: string;
  projectPriority: number;
  projectDeliveryDate: Date | null;
  lampId: string | null;
  process: ProcessCode;
  pendingHours: number;
}

export interface EngineAbsence {
  personId: string;
  date: Date;
  hours: number;
}

export interface EngineHoliday {
  date: Date;
}

export interface EngineInput {
  weekStart: Date;
  processes: EngineProcessDef[];
  people: EnginePerson[];
  tasks: EngineTask[];
  absences: EngineAbsence[];
  holidays: EngineHoliday[];
}

export interface EngineAssignment {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: ProcessCode;
  isAfternoon: boolean;
}

export interface EngineWarning {
  taskId: string;
  reason: string;
}

export interface EngineResult {
  assignments: EngineAssignment[];
  warnings: EngineWarning[];
  unscheduledHours: number;
}
