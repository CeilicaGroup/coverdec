import { describe, expect, it } from "vitest";
import {
  buildElementTypeImageAvailability,
  elementTypeImageAvailable,
  elementTypeImageUrl,
  elementTypeImageVersion,
} from "../element-type-image";

describe("element-type-image", () => {
  it("builds availability map from rows with imageUpdatedAt", () => {
    const updatedAt = new Date("2026-07-15T10:00:00.000Z");
    const map = buildElementTypeImageAvailability([
      { id: "et-1", imageUpdatedAt: updatedAt },
      { id: "et-2", imageUpdatedAt: null },
    ]);
    expect(map).toEqual({ "et-1": updatedAt.getTime() });
  });

  it("reports availability only when version exists", () => {
    const availability = { "et-1": 1_000 };
    expect(elementTypeImageAvailable(availability, "et-1")).toBe(true);
    expect(elementTypeImageAvailable(availability, "et-2")).toBe(false);
    expect(elementTypeImageAvailable(undefined, "et-1")).toBe(false);
    expect(elementTypeImageAvailable(availability, null)).toBe(false);
  });

  it("returns version for cache busting", () => {
    const availability = { "et-1": 1_700_000_000_000 };
    expect(elementTypeImageVersion(availability, "et-1")).toBe(1_700_000_000_000);
    expect(elementTypeImageVersion(availability, "missing")).toBeUndefined();
  });

  it("builds image URL with optional cache buster", () => {
    expect(elementTypeImageUrl("et-1")).toBe("/api/catalog/element-type-image/et-1");
    expect(elementTypeImageUrl("et-1", 1_700_000_000_000)).toBe(
      "/api/catalog/element-type-image/et-1?v=1700000000000",
    );
    expect(elementTypeImageUrl("et-1", new Date("2026-07-15T10:00:00.000Z"))).toBe(
      `/api/catalog/element-type-image/et-1?v=${new Date("2026-07-15T10:00:00.000Z").getTime()}`,
    );
  });
});
