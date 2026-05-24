import { getMondayOf, toUtcDay, weekDays } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTERS_PER_DAY = 24 * 4;

export const PLAN_FROM_OPTIONS = [
  { value: "WEEK_START", label: "Lunes de la semana" },
  { value: "TODAY", label: "Hoy" },
  { value: "TOMORROW", label: "Mañana" },
  { value: "NOW", label: "Ahora mismo" },
] as const;

export type PlanFrom = (typeof PLAN_FROM_OPTIONS)[number]["value"];

export const PLAN_FROM_STORAGE_KEY = "coverdec.planFrom";

/** Índice 0–4 (lun–vie) del primer día planificable; 5 = ningún día en la semana. */
export function findFirstSchedulableDayIndex(
  weekStart: Date,
  anchor: Date,
): number {
  const days = weekDays(getMondayOf(weekStart));
  const anchorDay = toUtcDay(anchor);
  if (anchorDay.getTime() < days[0].getTime()) return 0;
  if (anchorDay.getTime() > days[4].getTime()) return 5;
  const idx = days.findIndex((d) => d.getTime() >= anchorDay.getTime());
  return idx >= 0 ? idx : 5;
}

export function minuteToWeekQuarter(dayIndex: number, minuteOfDay: number): number {
  return dayIndex * QUARTERS_PER_DAY + Math.floor(minuteOfDay / 15);
}

export function computePlanFromBounds(
  weekStart: Date,
  planFrom: PlanFrom,
  planFromAt: Date,
): { firstSchedulableDayIndex: number; firstSchedulableWeekQuarter?: number } {
  if (planFrom === "WEEK_START") {
    return { firstSchedulableDayIndex: 0 };
  }

  let anchor = planFromAt;
  if (planFrom === "TOMORROW") {
    anchor = new Date(toUtcDay(planFromAt).getTime() + DAY_MS);
  }

  const firstSchedulableDayIndex = findFirstSchedulableDayIndex(weekStart, anchor);
  if (firstSchedulableDayIndex >= 5) {
    return { firstSchedulableDayIndex: 5 };
  }

  if (planFrom !== "NOW") {
    return { firstSchedulableDayIndex };
  }

  const days = weekDays(getMondayOf(weekStart));
  const firstDay = days[firstSchedulableDayIndex];
  if (!firstDay || toUtcDay(anchor).getTime() !== firstDay.getTime()) {
    return { firstSchedulableDayIndex };
  }

  const minuteOfDay = planFromAt.getUTCHours() * 60 + planFromAt.getUTCMinutes();
  const firstSchedulableWeekQuarter = minuteToWeekQuarter(
    firstSchedulableDayIndex,
    minuteOfDay,
  );

  return { firstSchedulableDayIndex, firstSchedulableWeekQuarter };
}

export function planFromLabel(planFrom: PlanFrom): string {
  return (
    PLAN_FROM_OPTIONS.find((o) => o.value === planFrom)?.label ??
    "Planificar desde"
  );
}

export function planFromHelpText(planFrom: PlanFrom): string {
  switch (planFrom) {
    case "WEEK_START":
      return "Solo se asignará trabajo desde el lunes de la semana seleccionada.";
    case "TODAY":
      return "Solo se asignará trabajo desde hoy (o el siguiente día laborable de la semana).";
    case "TOMORROW":
      return "Solo se asignará trabajo desde mañana (o el siguiente día laborable de la semana).";
    case "NOW":
      return "Solo se asignará trabajo desde el cuarto de hora actual en adelante.";
    default:
      return "";
  }
}
