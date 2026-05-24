import type { ProcessCode } from "@/types/process";

const NORMALIZED: Record<string, ProcessCode> = {
  CNC: "CNC",
  ENSAMBLAJE: "ENSAMBLAJE",
  LIJADO: "LIJADO",
  "LIJADO Y/O MASILLADO": "LIJADO",
  "LIJADO Y MASILLADO": "LIJADO",
  MASILLADO: "LIJADO",
  IMPRIMACION: "IMPRIMACION",
  "IMPRIMACIÓN": "IMPRIMACION",
  "IMPRIMACION/PINTURA": "IMPRIMACION",
  PINTURA: "PINTURA",
  PERFILES: "PERFILES",
  "COLOCACION DE PERFILES": "PERFILES",
  "COLOCACIÓN DE PERFILES": "PERFILES",
  EMBALAJE: "EMBALAJE",
  "EMBALAJE/CARGA/DESCARGA MATERIAL": "EMBALAJE",
  "EMBALAJE/CARGA": "EMBALAJE",
  "PEGADO ESPEJO": "PEGADO_ESPEJO",
  "PEGADO DE ESPEJO": "PEGADO_ESPEJO",
  "PEGADO DE COMPOSITE ESPEJO PLATA": "PEGADO_ESPEJO",
  "PEGADO DE COMPOSITE": "PEGADO_ESPEJO",
  "PEGADO DE COMPOSITE/CHAPA": "PEGADO_ESPEJO",
  "CORTE MANUAL": "CORTE_MANUAL",
  LIMPIEZA: "LIMPIEZA",
};

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export function mapProcess(value: unknown): ProcessCode | null {
  if (value == null) return null;
  const key = normalize(String(value));
  if (!key) return null;
  return NORMALIZED[key] ?? null;
}
