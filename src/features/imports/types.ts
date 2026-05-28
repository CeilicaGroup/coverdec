import type { ProcessCode } from "@/types/process";

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

export type BastidorFieldKey = (typeof BASTIDOR_FIELDS)[number];

export type ImportFieldKey = BastidorFieldKey;

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

export interface SheetColumnOption {
  index: number;
  letter: string;
  label: string;
}

export interface ImportInspectResult {
  sessionId: string;
  sheetNames: string[];
  suggestedMapping: ImportMapping;
  columnOptions: SheetColumnOption[];
  sampleRowCount: number;
}

export interface ImportApplyResult {
  bastidores: BastidorApplySummary;
}

/** Legacy full import summary (CLI script). */
export interface ImportSummary {
  bastidores: { created: number; updated: number; skipped: number };
  processesCreated: number;
}

export const IMPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
