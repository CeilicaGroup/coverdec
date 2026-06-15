import { getMondayOf, toUtcDay, weekDays } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUARTERS_PER_DAY = 24 * 4;

export function weekQuarterToDayIndex(weekQuarter: number): number {
  return Math.floor(weekQuarter / QUARTERS_PER_DAY);
}

/** Permite planificar días anteriores al ancla si la cadena de procesos lo exige. */
export function relaxFirstSchedulableDayForChain(
  firstSchedulableDayIndex: number,
  firstSchedulableWeekQuarter: number | undefined,
  minWeekQuarters: Iterable<number | undefined>,
): { firstSchedulableDayIndex: number; firstSchedulableWeekQuarter?: number } {
  let chainMinDay = firstSchedulableDayIndex;
  for (const wq of minWeekQuarters) {
    if (wq === undefined) continue;
    chainMinDay = Math.min(chainMinDay, weekQuarterToDayIndex(wq));
  }
  if (chainMinDay >= firstSchedulableDayIndex) {
    return { firstSchedulableDayIndex, firstSchedulableWeekQuarter };
  }
  return {
    firstSchedulableDayIndex: chainMinDay,
    firstSchedulableWeekQuarter: undefined,
  };
}

export const PLAN_FROM_OPTIONS = [
  { value: "WEEK_START", label: "Lunes de la semana" },
  { value: "DATE", label: "Fecha elegida" },
  { value: "TODAY", label: "Hoy" },
  { value: "TOMORROW", label: "Mañana" },
  { value: "NOW", label: "Ahora mismo" },
] as const;

export type PlanFrom = (typeof PLAN_FROM_OPTIONS)[number]["value"];

export const PLAN_FROM_STORAGE_KEY = "coverdec.planFrom";

export function weekWorkdayIsoRange(weekStart: Date | string): {
  mondayIso: string;
  fridayIso: string;
} {
  const monday = getMondayOf(
    typeof weekStart === "string" ? new Date(weekStart) : weekStart,
  );
  const days = weekDays(monday);
  return {
    mondayIso: days[0].toISOString().slice(0, 10),
    fridayIso: days[4].toISOString().slice(0, 10),
  };
}

/** Por defecto hoy si cae en la semana; si la semana es futura, lunes; si es pasada, lunes. */
export function defaultPlanFromDateIso(
  weekStart: Date | string,
  at: Date = new Date(),
): string {
  const { mondayIso, fridayIso } = weekWorkdayIsoRange(weekStart);
  const todayIso = toUtcDay(at).toISOString().slice(0, 10);
  if (todayIso < mondayIso || todayIso > fridayIso) return mondayIso;
  return todayIso;
}

export function assertPlanFromDateInWorkWeek(
  weekStart: Date | string,
  planFromDateIso: string,
): void {
  const { mondayIso, fridayIso } = weekWorkdayIsoRange(weekStart);
  if (planFromDateIso < mondayIso || planFromDateIso > fridayIso) {
    throw new Error(
      "«Planificar desde» debe ser un día laborable (lun–vie) de la semana del calendario.",
    );
  }
}

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

/** Ancla temporal única según la opción del menú «Planificar desde». */
export function resolvePlanFromAnchor(
  weekStart: Date,
  planFrom: PlanFrom,
  planFromAt: Date,
): Date {
  const monday = getMondayOf(weekStart);
  switch (planFrom) {
    case "WEEK_START":
      return monday;
    case "DATE":
    case "TODAY":
      return toUtcDay(planFromAt);
    case "TOMORROW":
      return new Date(toUtcDay(planFromAt).getTime() + DAY_MS);
    case "NOW":
      return planFromAt;
  }
}

export function computePlanFromBounds(
  weekStart: Date,
  planFrom: PlanFrom,
  planFromAt: Date,
): { firstSchedulableDayIndex: number; firstSchedulableWeekQuarter?: number } {
  if (planFrom === "WEEK_START") {
    return { firstSchedulableDayIndex: 0 };
  }

  const anchor = resolvePlanFromAnchor(weekStart, planFrom, planFromAt);
  const firstSchedulableDayIndex = findFirstSchedulableDayIndex(weekStart, anchor);
  if (firstSchedulableDayIndex >= 5) {
    return { firstSchedulableDayIndex: 5 };
  }

  const days = weekDays(getMondayOf(weekStart));
  const firstDay = days[firstSchedulableDayIndex];
  if (!firstDay) {
    return { firstSchedulableDayIndex };
  }

  const anchorDay = toUtcDay(anchor);
  const hasIntraday =
    anchorDay.getTime() === firstDay.getTime() &&
    anchor.getTime() > anchorDay.getTime();

  if (!hasIntraday) {
    return { firstSchedulableDayIndex };
  }

  const minuteOfDay = anchor.getUTCHours() * 60 + anchor.getUTCMinutes();
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
    case "DATE":
      return "Solo se asignará trabajo desde el día indicado en adelante dentro de la semana.";
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
