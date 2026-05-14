import { ProcessCode } from "@/generated/prisma";

const NORMALIZED: Record<string, ProcessCode> = {
  CNC: ProcessCode.CNC,
  ENSAMBLAJE: ProcessCode.ENSAMBLAJE,
  LIJADO: ProcessCode.LIJADO,
  "LIJADO Y/O MASILLADO": ProcessCode.LIJADO,
  "LIJADO Y MASILLADO": ProcessCode.LIJADO,
  MASILLADO: ProcessCode.LIJADO,
  IMPRIMACION: ProcessCode.IMPRIMACION,
  "IMPRIMACIÓN": ProcessCode.IMPRIMACION,
  "IMPRIMACION/PINTURA": ProcessCode.IMPRIMACION,
  PINTURA: ProcessCode.PINTURA,
  PERFILES: ProcessCode.PERFILES,
  "COLOCACION DE PERFILES": ProcessCode.PERFILES,
  "COLOCACIÓN DE PERFILES": ProcessCode.PERFILES,
  EMBALAJE: ProcessCode.EMBALAJE,
  "EMBALAJE/CARGA/DESCARGA MATERIAL": ProcessCode.EMBALAJE,
  "EMBALAJE/CARGA": ProcessCode.EMBALAJE,
  "PEGADO ESPEJO": ProcessCode.PEGADO_ESPEJO,
  "PEGADO DE ESPEJO": ProcessCode.PEGADO_ESPEJO,
  "PEGADO DE COMPOSITE ESPEJO PLATA": ProcessCode.PEGADO_ESPEJO,
  "PEGADO DE COMPOSITE": ProcessCode.PEGADO_ESPEJO,
  "PEGADO DE COMPOSITE/CHAPA": ProcessCode.PEGADO_ESPEJO,
  "CORTE MANUAL": ProcessCode.CORTE_MANUAL,
  LIMPIEZA: ProcessCode.LIMPIEZA,
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
