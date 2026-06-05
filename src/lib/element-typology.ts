import { ElementTypology } from "@/generated/prisma";

export const ELEMENT_TYPOLOGY_LABELS: Record<ElementTypology, string> = {
  TELA: "Tela",
  BASTIDOR: "Bastidor",
  ILUMINACION: "Iluminación",
};

export const ELEMENT_TYPOLOGIES = Object.keys(
  ELEMENT_TYPOLOGY_LABELS,
) as ElementTypology[];
