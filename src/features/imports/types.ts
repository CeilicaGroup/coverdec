import type { ProcessCode } from "@/types/process";

export type ImportKind =
  | "bastidores"
  | "proyectos"
  | "horas"
  | "produccion_completa";

export type ImportRowStatus = "ok" | "warning" | "error" | "skipped";

export type ImportSeverity = "error" | "warning";

export type ImportAction = "create" | "update" | "skip";

export interface ImportIssue {
  code: string;
  field?: string;
  message: string;
  severity: ImportSeverity;
}

export const BASTIDOR_FIELDS = [
  "frameName",
  "processName",
  "hoursPerUnit",
  "frameCode",
] as const;

export const PROYECTO_FIELDS = [
  "projectName",
  "lampName",
  "frameTypeName",
  "surfaceM2",
  "deliveryDate",
  "areaName",
  "processName",
  "hrPlan",
  "hrTotal",
  "hrNormal",
  "hrExtra",
  "hrPending",
  "taskStatus",
  "projectStatus",
] as const;

export const HORAS_FIELDS = [
  "workDate",
  "operatorName",
  "projectName",
  "lampName",
  "areaName",
  "processName",
  "startTime",
  "endTime",
  "normalHours",
  "extraHours",
  "notes",
] as const;

export type BastidorFieldKey = (typeof BASTIDOR_FIELDS)[number];
export type ProyectoFieldKey = (typeof PROYECTO_FIELDS)[number];
export type HorasFieldKey = (typeof HORAS_FIELDS)[number];
export type ImportFieldKey = BastidorFieldKey | ProyectoFieldKey | HorasFieldKey;

export interface ImportMapping {
  sheetName: string;
  /** 1-based row index; data rows start at headerRow + 1 */
  headerRow: number;
  /** field key -> 1-based Excel column index, null = unmapped */
  columnMap: Partial<Record<ImportFieldKey, number | null>>;
}

export interface BastidorRowDraft {
  rowIndex: number;
  frameName: string;
  processName: string;
  hoursPerUnit: number | null;
  frameCode: string | null;
  processCode: ProcessCode | null;
  issues: ImportIssue[];
  status: ImportRowStatus;
  action: ImportAction;
}

export interface ProyectoRowDraft {
  rowIndex: number;
  projectName: string;
  lampName: string;
  frameTypeName: string;
  surfaceM2: number | null;
  deliveryDate: Date | null;
  areaName: string;
  processName: string;
  hrPlan: number | null;
  hrTotal: number | null;
  hrNormal: number | null;
  hrExtra: number | null;
  hrPending: number | null;
  taskStatus: string;
  projectStatus: string;
  processCode: ProcessCode | null;
  elementTypeId: string | null;
  elementTypeName: string | null;
  projectId: string | null;
  lampId: string | null;
  taskId: string | null;
  isCompleted: boolean;
  archiveProject: boolean;
  issues: ImportIssue[];
  status: ImportRowStatus;
  action: ImportAction;
}

export interface HorasRowDraft {
  rowIndex: number;
  workDate: Date | null;
  operatorName: string;
  projectName: string;
  lampName: string;
  areaName: string;
  processName: string;
  startTimeMinutes: number | null;
  endTimeMinutes: number | null;
  normalHours: number | null;
  extraHours: number | null;
  notes: string;
  totalHours: number | null;
  processCode: ProcessCode | null;
  userId: string | null;
  operatorLabel: string | null;
  projectId: string | null;
  lampId: string | null;
  taskId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  issues: ImportIssue[];
  status: ImportRowStatus;
  action: ImportAction;
}

export interface ImportPreviewSummary {
  total: number;
  ok: number;
  warning: number;
  error: number;
  skipped: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
}

export function countBlockingImportErrors(
  rows: Array<{ status: ImportRowStatus; action: ImportAction }>,
): number {
  return rows.filter((r) => r.status === "error" && r.action !== "skip").length;
}

const REVIEW_STATUS_ORDER: Record<ImportRowStatus, number> = {
  error: 0,
  warning: 1,
  ok: 2,
  skipped: 3,
};

/** Puts error rows first in the import review table. */
export function compareImportRowsForReview<
  T extends { status: ImportRowStatus; rowIndex: number },
>(a: T, b: T): number {
  const byStatus = REVIEW_STATUS_ORDER[a.status] - REVIEW_STATUS_ORDER[b.status];
  if (byStatus !== 0) return byStatus;
  return a.rowIndex - b.rowIndex;
}

export interface ImportPreview<T> {
  rows: T[];
  summary: ImportPreviewSummary;
}

export interface BastidorApplySummary {
  created: number;
  updated: number;
  skipped: number;
  processesCreated: number;
}

export interface ProyectoApplySummary {
  projectsCreated: number;
  projectsUpdated: number;
  projectsArchived: number;
  lampsCreated: number;
  lampsUpdated: number;
  tasksCreated: number;
  tasksUpdated: number;
  skipped: number;
}

export interface HorasApplySummary {
  created: number;
  skipped: number;
  warnings: number;
}

export interface SheetColumnOption {
  index: number;
  letter: string;
  label: string;
}

export interface ImportInspectResult {
  sessionId: string;
  sheetNames: string[];
  importKind: ImportKind;
  availableKinds: ImportKind[];
  suggestedMapping: ImportMapping;
  columnOptions: SheetColumnOption[];
  sampleRowCount: number;
}

export interface ImportApplyResult {
  importKind: ImportKind;
  bastidores?: BastidorApplySummary;
  proyectos?: ProyectoApplySummary;
  horas?: HorasApplySummary;
}

/** Legacy full import summary (CLI script). */
export interface ImportSummary {
  bastidores: { created: number; updated: number; skipped: number };
  processesCreated: number;
  proyectos: ProyectoApplySummary;
  horas: HorasApplySummary;
}

export const IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;

export const LEGACY_HORAS_IMPORT_NOTE_PREFIX = "legacy-import:horas:row:";

export function legacyHorasImportNote(rowIndex: number): string {
  return `${LEGACY_HORAS_IMPORT_NOTE_PREFIX}${rowIndex}`;
}

export function isTerminatedStatus(value: string): boolean {
  return value.trim().toLowerCase() === "terminado";
}

export function deriveTaskCompleted(input: {
  taskStatus: string;
  hrPlan: number | null;
  hrTotal: number | null;
  hrPending: number | null;
}): boolean {
  if (isTerminatedStatus(input.taskStatus)) return true;
  if (input.hrPending != null && input.hrPending <= 0) return true;
  if (
    input.hrPlan != null &&
    input.hrTotal != null &&
    input.hrTotal >= input.hrPlan - 0.05
  ) {
    return true;
  }
  return false;
}

export function deriveHrPending(input: {
  hrPlan: number | null;
  hrTotal: number | null;
  hrPending: number | null;
  taskStatus: string;
}): number | null {
  if (isTerminatedStatus(input.taskStatus)) return 0;
  if (input.hrPending != null && Number.isFinite(input.hrPending)) {
    return input.hrPending;
  }
  if (input.hrPlan != null && input.hrTotal != null) {
    return Math.max(0, input.hrPlan - input.hrTotal);
  }
  return input.hrPending;
}
