import { describe, expect, it } from "vitest";
import { ProjectKind } from "@/generated/prisma";
import {
  internalProjectDisplayLabel,
  isImprevistasProjectKind,
  isInternalProjectKind,
} from "@/lib/project-kind";

describe("internal project kinds", () => {
  it("identifies imprevistas and internal pools", () => {
    expect(isImprevistasProjectKind(ProjectKind.IMPREVISTAS)).toBe(true);
    expect(isImprevistasProjectKind(ProjectKind.STOCK)).toBe(false);
    expect(isInternalProjectKind(ProjectKind.STOCK)).toBe(true);
    expect(isInternalProjectKind(ProjectKind.IMPREVISTAS)).toBe(true);
    expect(isInternalProjectKind(ProjectKind.PRODUCCION)).toBe(false);
  });

  it("maps internal project labels for OT filters", () => {
    expect(
      internalProjectDisplayLabel(ProjectKind.STOCK, "Pool de stock"),
    ).toBe("Stock");
    expect(
      internalProjectDisplayLabel(
        ProjectKind.IMPREVISTAS,
        "Pool de imprevistas",
      ),
    ).toBe("Imprevistas");
    expect(
      internalProjectDisplayLabel(ProjectKind.PRODUCCION, "Cliente A"),
    ).toBe("Cliente A");
  });
});
