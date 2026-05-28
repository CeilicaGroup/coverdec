import { BASTIDOR_FIELDS } from "./types";

const BASTIDOR_LABELS: Record<(typeof BASTIDOR_FIELDS)[number], string> = {
  frameName: "Nombre bastidor",
  processName: "Proceso",
  hoursPerUnit: "Horas / m²",
  frameCode: "Código bastidor (opcional)",
};

const BASTIDOR_REQUIRED = new Set(["frameName", "processName", "hoursPerUnit"]);

export function getFieldDefinitions() {
  return BASTIDOR_FIELDS.map((key) => ({
    key,
    label: BASTIDOR_LABELS[key],
    required: BASTIDOR_REQUIRED.has(key),
  }));
}
