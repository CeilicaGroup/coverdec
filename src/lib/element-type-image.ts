/** Milliseconds since epoch; keyed by ElementType id for cache-busting image URLs. */
export type ElementTypeImageAvailability = Record<string, number>;

export function buildElementTypeImageAvailability(
  rows: Array<{ id: string; imageUpdatedAt?: Date | null }>,
): ElementTypeImageAvailability {
  const map: ElementTypeImageAvailability = {};
  for (const row of rows) {
    if (row.imageUpdatedAt != null) {
      map[row.id] = row.imageUpdatedAt.getTime();
    }
  }
  return map;
}

export function elementTypeImageAvailable(
  availability: ElementTypeImageAvailability | undefined,
  elementTypeId: string | null | undefined,
): boolean {
  if (!elementTypeId) return false;
  const version = availability?.[elementTypeId];
  return version != null && Number.isFinite(version);
}

export function elementTypeImageVersion(
  availability: ElementTypeImageAvailability | undefined,
  elementTypeId: string | null | undefined,
): number | undefined {
  if (!elementTypeId) return undefined;
  const version = availability?.[elementTypeId];
  return version !== undefined && Number.isFinite(version) ? version : undefined;
}

export function elementTypeImageUrl(
  elementTypeId: string,
  updatedAt?: Date | string | number | null,
): string {
  const base = `/api/catalog/element-type-image/${elementTypeId}`;
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
