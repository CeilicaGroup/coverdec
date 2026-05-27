/** Valores para `<input type="datetime-local" />` en zona de visualización (Europe/Madrid). */

const DISPLAY_TIME_ZONE = "Europe/Madrid";

function formatPartsInZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function toDatetimeLocalInputValue(
  date: Date | string,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const { year, month, day, hour, minute } = formatPartsInZone(d, timeZone);
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function fromDatetimeLocalInputValue(
  value: string,
  timeZone: string = DISPLAY_TIME_ZONE,
): string {
  const [datePart, timePart] = value.split("T");
  const [y, mo, d] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);

  let timestamp = Date.UTC(y, mo - 1, d, h, mi);
  for (let attempt = 0; attempt < 5; attempt++) {
    const check = toDatetimeLocalInputValue(new Date(timestamp), timeZone);
    if (check === value) return new Date(timestamp).toISOString();
    const parsed = formatPartsInZone(new Date(timestamp), timeZone);
    const targetMinutes = h * 60 + mi;
    const currentMinutes = Number(parsed.hour) * 60 + Number(parsed.minute);
    let dayAdjust = 0;
    if (Number(parsed.day) !== d) {
      dayAdjust = Number(parsed.day) > d ? -1 : 1;
    }
    timestamp += (targetMinutes - currentMinutes + dayAdjust * 24 * 60) * 60_000;
  }
  return new Date(timestamp).toISOString();
}

export function toIsoUtcFromDateAndHour(date: Date, hourDecimal: number): string {
  const dt = new Date(date);
  const h = Math.floor(hourDecimal);
  const m = Math.round((hourDecimal - h) * 60);
  dt.setUTCHours(h, m, 0, 0);
  return dt.toISOString();
}

export function planningRangeToDatetimeLocal(
  date: Date,
  startHourDecimal: number,
  endHourDecimal: number,
): { startedAt: string; endedAt: string } {
  const startedAt = new Date(date);
  const startH = Math.floor(startHourDecimal);
  const startM = Math.round((startHourDecimal - startH) * 60);
  startedAt.setUTCHours(startH, startM, 0, 0);

  const endedAt = new Date(date);
  const endH = Math.floor(endHourDecimal);
  const endM = Math.round((endHourDecimal - endH) * 60);
  endedAt.setUTCHours(endH, endM, 0, 0);

  return {
    startedAt: toDatetimeLocalInputValue(startedAt),
    endedAt: toDatetimeLocalInputValue(endedAt),
  };
}
