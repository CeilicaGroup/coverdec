import { ELEMENT_TYPOLOGY_LABELS } from "@/lib/element-typology";
import type { ElementTypology } from "@/generated/prisma";

/** Milliseconds since epoch; used for cache-busting image URLs. */
export type TypologyImageAvailability = Partial<Record<ElementTypology, number>>;

export function buildTypologyImageAvailability(
  rows: Array<{ typology: ElementTypology; imageUpdatedAt?: Date | null }>,
): TypologyImageAvailability {
  const map: TypologyImageAvailability = {};
  for (const row of rows) {
    if (row.imageUpdatedAt != null) {
      map[row.typology] = row.imageUpdatedAt.getTime();
    }
  }
  return map;
}

export function typologyImageAvailable(
  availability: TypologyImageAvailability | undefined,
  typology: ElementTypology,
): boolean | undefined {
  const version = availability?.[typology];
  if (version === undefined) return undefined;
  return Number.isFinite(version);
}

export function typologyImageVersion(
  availability: TypologyImageAvailability | undefined,
  typology: ElementTypology,
): number | undefined {
  const version = availability?.[typology];
  return version !== undefined && Number.isFinite(version) ? version : undefined;
}

export function typologyImageUrl(
  typology: ElementTypology,
  updatedAt?: Date | string | number | null,
): string {
  const base = `/api/catalog/typology-image/${typology}`;
  if (updatedAt == null) return base;
  const ts =
    updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === "number"
        ? updatedAt
        : new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return base;
  return `${base}?v=${ts}`;
}

export function typologyImageAlt(typology: ElementTypology): string {
  return ELEMENT_TYPOLOGY_LABELS[typology];
}
