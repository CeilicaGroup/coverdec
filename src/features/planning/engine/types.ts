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
  /** Nave única del operario; solo puede ejecutar tareas de esta nave. */
  naveId: string;
  primary: string[];
  fallback: string[];
  /** Average weekday capacity derived from configured work windows. */
  capacityHours: number;
  hourlyRate: number;
  overtimeHourlyRate: number;
}

export interface EngineTask {
  id: string;
  projectId: string;
  projectPriority: number;
  deadlineCurveExponent: number;
  overduePenaltyMultiplier: number;
  projectDeliveryDate: Date | null;
  lampId: string;
  lampElementId?: string | null;
  order: number;
  process: string;
  pendingHours: number;
  /** Nave donde se ejecuta la tarea; solo operarios de esta nave pueden asignarse. */
  naveId: string;
  /** Earliest week-quarter index (from prior-week planning on the same element chain). */
  minWeekQuarter?: number;
  /** When false, task must be scheduled in a single calendar day. */
  canFragment?: boolean;
  /** When set, only this worker may be assigned (task already started). */
  ownerPersonId?: string | null;
  /** Open work-order grouping: same worker, sequential placement. */
  workOrderId?: string | null;
  workOrderSequence?: number | null;
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

/** Franja ya ocupada en otra nave (bloquea al trabajador, sin tarea en esta nave). */
export interface EngineBusySlot {
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
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
