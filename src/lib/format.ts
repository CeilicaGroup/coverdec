export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return "—";
  const rounded = Math.round(hours * 100) / 100;
  const text =
    rounded % 1 === 0
      ? rounded.toFixed(0)
      : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}h`;
}

/** Horas decimales → duración HH:MM (p. ej. 2.5 → 02:30). */
export function formatHoursAsHhMm(hours: number | null | undefined): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const mm = String(totalMinutes % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const DEFAULT_DISPLAY_TIME_ZONE = "Europe/Madrid";

function hourDecimalInZone(
  date: Date,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): number {
  const parts = new Intl.DateTimeFormat("es-ES", {
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    timeZone,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

export function formatDayTimeInZone(
  date: Date,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

export function formatTimeRangeFromStartAndHours(
  startedAt: Date,
  hours: number,
  timeZone: string = DEFAULT_DISPLAY_TIME_ZONE,
): string {
  const endedAt = new Date(startedAt.getTime() + hours * 3_600_000);
  return `${formatHoursAsHhMm(hourDecimalInZone(startedAt, timeZone))}–${formatHoursAsHhMm(hourDecimalInZone(endedAt, timeZone))}`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  });
}

export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  });
}

/** Fecha corta con hora (ej. 22/07/2026 14:30). */
export function formatShortDateTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  });
}

/** Eje de calendario / grid: día y mes cortos con año (ej. 19 may 2026). */
export function formatDayMonthYear(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  });
}

export function formatEuros(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const HOURLY_RATE = 14.75;
export const OVERTIME_RATE = 20.65;

export function riskFromDelivery(
  deliveryDate: Date | string | null | undefined,
): "OK" | "ATENCION" | "RIESGO" | "SIN_FECHA" {
  if (!deliveryDate) return "SIN_FECHA";
  const d = typeof deliveryDate === "string" ? new Date(deliveryDate) : deliveryDate;
  const now = new Date();
  const days = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 7) return "RIESGO";
  if (days <= 14) return "ATENCION";
  return "OK";
}

export function riskFromPlannedEnd(
  deliveryDate: Date | null | undefined,
  lastPlannedDate: Date | null | undefined,
): "OK" | "ATENCION" | "RIESGO" | "SIN_FECHA" {
  if (!deliveryDate) return "SIN_FECHA";
  if (!lastPlannedDate) return riskFromDelivery(deliveryDate);
  const diffDays = Math.round(
    (deliveryDate.getTime() - lastPlannedDate.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "RIESGO";
  if (diffDays <= 5) return "ATENCION";
  return "OK";
}

export function daysUntil(
  deliveryDate: Date | string | null | undefined,
): number | null {
  if (!deliveryDate) return null;
  const d = typeof deliveryDate === "string" ? new Date(deliveryDate) : deliveryDate;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
