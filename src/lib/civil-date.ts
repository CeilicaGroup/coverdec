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
