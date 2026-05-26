export const WORKDAY_HOURS = 8;
export const MORNING_START = 8;
export const MORNING_END = 14;
export const AFTERNOON_START = 15;
export const AFTERNOON_END = 17;

export interface EngineProcessDef {
  code: string;
  /** Hours the next process must wait after this one finishes (e.g. paint drying). */
  waitHours: number;
}

export interface EnginePerson {
  id: string;
  iniciales: string;
  primary: string[];
  fallback: string[];
  capacityHours: number;
  hourlyRate: number;
  overtimeHourlyRate: number;
}

export interface EngineTask {
  id: string;
  projectId: string;
  projectDeliveryDate: Date | null;
  lampId: string;
  order: number;
  process: string;
  pendingHours: number;
  /** Earliest week-quarter index (from prior-week planning on the same lamp). */
  minWeekQuarter?: number;
}

export interface EngineAbsence {
  personId: string;
  date: Date;
  hours: number;
  blockStartMinutes?: number | null;
  blockEndMinutes?: number | null;
}

export interface EngineHoliday {
  date: Date;
}

export interface EngineFixedAssignment {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
}

export interface EngineBookedHours {
  personId: string;
  date: Date;
  hours: number;
}

export interface EngineWarning {
  taskId: string;
  reason: string;
}

export interface EngineAssignment {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
  hours: number;
  process: string;
  isAfternoon: boolean;
}

export interface EngineInput {
  weekStart: Date;
  processes: EngineProcessDef[];
  people: EnginePerson[];
  tasks: EngineTask[];
  absences: EngineAbsence[];
  holidays: EngineHoliday[];
}

export interface EngineResult {
  assignments: EngineAssignment[];
  warnings: EngineWarning[];
  unscheduledHours: number;
}
