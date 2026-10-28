import type { CellValue } from "exceljs";

/**
 * Número escrito como texto en un Excel, en formato español o inglés.
 *
 * - Con punto y coma, el último que aparece es el decimal: "1.234,5" y "1,234.5" → 1234.5.
 * - Con un solo separador repetido ("1.234.567", "1,234,567") son miles.
 * - Con un único separador, es el decimal: "1,5" → 1.5 y "0.5" → 0.5.
 *   Eso incluye "1.500" → 1.5: todos los usos son medidas pequeñas (horas, horas/m², m²,
 *   mediciones), donde 1500 sería absurdo y un "1.5" pegado desde un formato inglés es lo habitual.
 *   Quien quiera miles en un texto debe escribirlos con decimales ("1.500,0") o como número.
 *
 * Devuelve null si el texto no es un número limpio (letras, separadores mal colocados…).
 */
export function parseDecimalText(text: string): number | null {
  const compact = text.replace(/[\s ]/g, "");
  if (!compact) return null;
  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const dots = compact.split(".").length - 1;
  const commas = compact.split(",").length - 1;

  // Los grupos de miles tras el primero tienen exactamente 3 cifras ("1.2.3" no es un número).
  const validGroups = (intPart: string, sep: string) =>
    intPart.split(sep).slice(1).every((g) => /^\d{3}$/.test(g));

  let normalized: string;
  if (dots > 0 && commas > 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    const group = decimal === "." ? "," : ".";
    if ((decimal === "." ? dots : commas) > 1) return null;
    const decimalAt = decimal === "." ? lastDot : lastComma;
    if (!validGroups(compact.slice(0, decimalAt), group)) return null;
    normalized = compact.split(group).join("").replace(decimal, ".");
  } else if (dots > 1 || commas > 1) {
    const group = dots > 1 ? "." : ",";
    if (!validGroups(compact, group)) return null;
    normalized = compact.split(group).join("");
  } else {
    normalized = compact.replace(",", ".");
  }

  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function readNumber(value: CellValue | undefined): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return parseDecimalText(value);
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (typeof result === "number") return Number.isFinite(result) ? result : null;
    if (typeof result === "string") return parseDecimalText(result);
  }
  return null;
}

export function readString(value: CellValue | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") return String(value);
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) {
      return Number.isNaN(result.getTime()) ? null : result.toISOString();
    }
    return result != null ? String(result).trim() || null : null;
  }
  if (typeof value === "object" && value && "richText" in value) {
    const rich = value as { richText?: { text: string }[] };
    return rich.richText?.map((rt) => rt.text).join(" ").trim() || null;
  }
  return null;
}

export function readDate(value: CellValue | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && value && "result" in value) {
    const result = (value as { result?: unknown }).result;
    if (result instanceof Date) return result;
    if (typeof result === "string") {
      const d = new Date(result);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}
