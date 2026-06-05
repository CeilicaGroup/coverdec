import {
  absenceCivilIsoEnd,
  absenceCivilIsoStart,
  isFullDayAbsenceBlock,
  isRangeAbsence,
} from "@/features/people/absence-model";
import { formatCivilIsoDate } from "@/lib/civil-date";

export function formatAbsenceDateLabel(a: {
  date: Date | string;
  endDate: Date | string;
}): string {
  const start =
    typeof a.date === "string" ? a.date.slice(0, 10) : absenceCivilIsoStart({ date: a.date });
  const end =
    typeof a.endDate === "string"
      ? a.endDate.slice(0, 10)
      : absenceCivilIsoEnd({ date: a.date as Date, endDate: a.endDate as Date });
  if (end > start) {
    return `${formatCivilIsoDate(start)} — ${formatCivilIsoDate(end)}`;
  }
  return formatCivilIsoDate(start);
}

export function formatAbsenceDetail(a: {
  date: Date | string;
  endDate: Date | string;
  hours: number;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
  reason: string | null;
}): string {
  const dateLabel = formatAbsenceDateLabel(a);
  const block =
    a.blockStartMinutes != null &&
    a.blockEndMinutes != null &&
    a.blockEndMinutes > a.blockStartMinutes &&
    !isFullDayAbsenceBlock(a);
  const timePart = block
    ? `${String(Math.floor(a.blockStartMinutes! / 60)).padStart(2, "0")}:${String(a.blockStartMinutes! % 60).padStart(2, "0")} - ${String(Math.floor(a.blockEndMinutes! / 60)).padStart(2, "0")}:${String(a.blockEndMinutes! % 60).padStart(2, "0")} (${a.hours}h)`
    : (() => {
        const start =
          typeof a.date === "string" ? a.date.slice(0, 10) : absenceCivilIsoStart({ date: a.date });
        const end =
          typeof a.endDate === "string"
            ? a.endDate.slice(0, 10)
            : absenceCivilIsoEnd({ date: a.date as Date, endDate: a.endDate as Date });
        return end > start ? `${a.hours}h en total` : `${a.hours}h día completo`;
      })();
  const reasonPart = a.reason ? ` · ${a.reason}` : "";
  return `${dateLabel} · ${timePart}${reasonPart}`;
}
