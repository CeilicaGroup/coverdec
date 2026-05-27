import {
  formatHours,
  formatShortDate,
  formatTimeRangeFromStartAndHours,
} from "@/lib/format";

export function formatActualEntrySummaryLabel(
  dateIso: string,
  hours: number,
  process: string | null | undefined,
): string {
  const processLabel = process?.trim() ? process : "—";
  return `${formatShortDate(new Date(`${dateIso}T00:00:00Z`))} · ${formatHours(hours)} · ${processLabel}`;
}

/** Etiqueta completa con franja horaria (vista referencia / stripe). */
export function formatActualEntryStripeLabel(
  dateIso: string,
  startedAt: Date,
  hours: number,
  process: string | null | undefined,
): string {
  const processLabel = process?.trim() ? process : "—";
  return `${formatShortDate(new Date(`${dateIso}T00:00:00Z`))} · ${formatTimeRangeFromStartAndHours(
    startedAt,
    hours,
  )} · ${formatHours(hours)} · ${processLabel}`;
}
