const CIVIL_ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** ISO civil YYYY-MM-DD desde un Date del calendario (componentes locales). */
export function civilIsoFromLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Medianoche local para pintar días en el calendario. */
export function localDateFromCivilIso(iso: string): Date {
  const m = CIVIL_ISO_RE.exec(iso);
  if (!m) return new Date(iso);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Formato español dd/mm/aaaa desde ISO civil. */
export function formatCivilIsoDate(iso: string): string {
  const m = CIVIL_ISO_RE.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatMonthYearEs(iso: string): string {
  const d = localDateFromCivilIso(iso.length >= 7 ? `${iso.slice(0, 7)}-01` : iso);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

export function expandCivilIsoRange(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  let cur = localDateFromCivilIso(startIso);
  const end = localDateFromCivilIso(endIso);
  while (cur.getTime() <= end.getTime()) {
    out.push(civilIsoFromLocalDate(cur));
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
  }
  return out;
}

const MONTH_PARAM_RE = /^(\d{4})-(\d{2})$/;

/** Primer día civil del mes (YYYY-MM o YYYY-MM-DD). */
export function parseMonthParam(value: string | undefined): string {
  if (value && MONTH_PARAM_RE.test(value)) {
    return `${value}-01`;
  }
  if (value && CIVIL_ISO_RE.test(value)) {
    return `${value.slice(0, 7)}-01`;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function monthStartEnd(monthStartIso: string): { startIso: string; endIso: string } {
  const start = localDateFromCivilIso(monthStartIso);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return {
    startIso: civilIsoFromLocalDate(start),
    endIso: civilIsoFromLocalDate(end),
  };
}

function civilIsoToUtcDate(iso: string): Date {
  const m = CIVIL_ISO_RE.exec(iso);
  if (!m) return new Date(iso);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Días laborables (lun–vie) del mes civil, en ISO UTC alineado al motor. */
export function businessDaysInMonth(
  monthStartIso: string,
  holidayDates: Set<string> = new Set(),
): string[] {
  const { startIso, endIso } = monthStartEnd(monthStartIso);
  const out: string[] = [];
  for (const civilIso of expandCivilIsoRange(startIso, endIso)) {
    const utc = civilIsoToUtcDate(civilIso);
    const dow = utc.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const planningIso = utc.toISOString().slice(0, 10);
    if (holidayDates.has(planningIso)) continue;
    out.push(planningIso);
  }
  return out;
}

/** Semanas del mes como filas de días laborables (lun–vie), con huecos null. */
export function monthCalendarWeeks(
  monthStartIso: string,
): Array<Array<{ iso: string; dayOfMonth: number } | null>> {
  const { startIso, endIso } = monthStartEnd(monthStartIso);
  const weeks: Array<Array<{ iso: string; dayOfMonth: number } | null>> = [];
  let row: Array<{ iso: string; dayOfMonth: number } | null> = [
    null,
    null,
    null,
    null,
    null,
  ];

  for (const civilIso of expandCivilIsoRange(startIso, endIso)) {
    const utc = civilIsoToUtcDate(civilIso);
    const dow = utc.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const planningIso = utc.toISOString().slice(0, 10);
    const col = dow - 1;
    if (col === 0 && row.some((c) => c != null)) {
      weeks.push(row);
      row = [null, null, null, null, null];
    }
    row[col] = { iso: planningIso, dayOfMonth: utc.getUTCDate() };
    if (col === 4) {
      weeks.push(row);
      row = [null, null, null, null, null];
    }
  }
  if (row.some((c) => c != null)) {
    weeks.push(row);
  }
  return weeks;
}
