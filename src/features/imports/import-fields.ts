import type { ImportKind } from "./types";
import {
  BASTIDOR_FIELDS,
  HORAS_FIELDS,
  PROYECTO_FIELDS,
} from "./types";

const BASTIDOR_LABELS: Record<(typeof BASTIDOR_FIELDS)[number], string> = {
  frameName: "Nombre bastidor",
  processName: "Proceso",
  hoursPerUnit: "Horas / m²",
  frameCode: "Código bastidor (opcional)",
};

const PROYECTO_LABELS: Record<(typeof PROYECTO_FIELDS)[number], string> = {
  projectName: "Proyecto",
  lampName: "Lámpara",
  frameTypeName: "Tipo bastidor",
  surfaceM2: "Medida (m²)",
  deliveryDate: "Fecha de entrega",
  areaName: "Área",
  processName: "Proceso",
  hrPlan: "Hr plan",
  hrTotal: "Hr total",
  hrNormal: "Hr normal",
  hrExtra: "Hr extra",
  hrPending: "Hr pendiente",
  taskStatus: "Estado tarea",
  projectStatus: "Estado proyecto",
};

const HORAS_LABELS: Record<(typeof HORAS_FIELDS)[number], string> = {
  workDate: "Fecha",
  operatorName: "Operario",
  projectName: "Proyecto",
  lampName: "Lámpara",
  areaName: "Área",
  processName: "Proceso",
  startTime: "Hora inicio",
  endTime: "Hora fin",
  normalHours: "Horas normales",
  extraHours: "Horas extras",
  notes: "Observaciones",
};

const BASTIDOR_REQUIRED = new Set(["frameName", "processName", "hoursPerUnit"]);
const PROYECTO_REQUIRED = new Set([
  "projectName",
  "lampName",
  "frameTypeName",
  "processName",
  "hrPlan",
]);
const HORAS_REQUIRED = new Set([
  "workDate",
  "operatorName",
  "projectName",
  "lampName",
  "processName",
]);

export function getFieldDefinitions(kind: ImportKind = "bastidores") {
  if (kind === "proyectos") {
    return PROYECTO_FIELDS.map((key) => ({
      key,
      label: PROYECTO_LABELS[key],
      required: PROYECTO_REQUIRED.has(key),
    }));
  }
  if (kind === "horas") {
    return HORAS_FIELDS.map((key) => ({
      key,
      label: HORAS_LABELS[key],
      required: HORAS_REQUIRED.has(key),
    }));
  }
  return BASTIDOR_FIELDS.map((key) => ({
    key,
    label: BASTIDOR_LABELS[key],
    required: BASTIDOR_REQUIRED.has(key),
  }));
}
