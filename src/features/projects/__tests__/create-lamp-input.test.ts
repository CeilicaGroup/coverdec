import { describe, expect, it } from "vitest";
import { ProjectKind } from "@/generated/prisma";
import { resolveCreateLampMode } from "@/features/projects/create-lamp-input";
import { ElementTypology } from "@/generated/prisma";

const sampleElement = {
  typology: ElementTypology.BASTIDOR,
  elementTypeId: "e1",
  surfaceM2: 2,
  units: 1,
};

describe("resolveCreateLampMode", () => {
  it("uses catalog mode for prototype projects with elements", () => {
    expect(
      resolveCreateLampMode(ProjectKind.PROTOTIPO, {
        projectId: "p1",
        name: "Lámpara A",
        elements: [sampleElement],
      }),
    ).toBe("catalog");
  });

  it("uses manual mode for budget projects with assigned hours", () => {
    expect(
      resolveCreateLampMode(ProjectKind.PRESUPUESTO, {
        projectId: "p1",
        name: "Lámpara A",
        estimatedHours: 12,
      }),
    ).toBe("manual");
  });

  it("requires elements or hours on flexible project kinds", () => {
    expect(() =>
      resolveCreateLampMode(ProjectKind.PROTOTIPO, {
        projectId: "p1",
        name: "Lámpara A",
      }),
    ).toThrow(/elementos o un total de horas/i);
  });

  it("rejects mixing elements and hours", () => {
    expect(() =>
      resolveCreateLampMode(ProjectKind.PRESUPUESTO, {
        projectId: "p1",
        name: "Lámpara A",
        estimatedHours: 8,
        elements: [sampleElement],
      }),
    ).toThrow(/no ambos/i);
  });

  it("requires elements for production projects", () => {
    expect(() =>
      resolveCreateLampMode(ProjectKind.PRODUCCION, {
        projectId: "p1",
        name: "Lámpara A",
      }),
    ).toThrow(/al menos un elemento/i);
  });

  it("rejects manual hours on production projects", () => {
    expect(() =>
      resolveCreateLampMode(ProjectKind.PRODUCCION, {
        projectId: "p1",
        name: "Lámpara A",
        estimatedHours: 8,
      }),
    ).toThrow(/solo están disponibles en prototipos/i);
  });

  it("uses catalog mode for production projects with elements", () => {
    expect(
      resolveCreateLampMode(ProjectKind.PRODUCCION, {
        projectId: "p1",
        name: "Lámpara A",
        elements: [sampleElement],
      }),
    ).toBe("catalog");
  });
});
