export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return "—";
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 2)}h`;
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatShortDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
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

export function daysUntil(
  deliveryDate: Date | string | null | undefined,
): number | null {
  if (!deliveryDate) return null;
  const d = typeof deliveryDate === "string" ? new Date(deliveryDate) : deliveryDate;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
