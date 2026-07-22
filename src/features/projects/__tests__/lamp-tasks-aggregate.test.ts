import { describe, expect, it } from "vitest";
import {
  aggregateTasksByProcess,
  dryWaitHoursForProcess,
  groupTasksByBastidor,
  scaleBlueprintHoursForUnits,
} from "@/features/projects/lamp-tasks";
import { ElementTypology } from "@/generated/prisma";
import { lampElementsToConfig } from "@/features/projects/sync-lamp-elements";

describe("scaleBlueprintHoursForUnits", () => {
  it("multiplies hours when units > 1", () => {
    const blueprints = [
      { process: "CNC" as const, estimatedHours: 1.7, order: 0, naveId: "n1" },
      { process: "ENSAMBLAJE" as const, estimatedHours: 3.2, order: 1, naveId: "n1" },
    ];
    expect(scaleBlueprintHoursForUnits(blueprints, 4)).toEqual([
      { process: "CNC", estimatedHours: 6.8, order: 0, naveId: "n1" },
      { process: "ENSAMBLAJE", estimatedHours: 12.8, order: 1, naveId: "n1" },
    ]);
  });
});

describe("dryWaitHoursForProcess", () => {
  it("returns catalog wait hours for the process, not a predecessor", () => {
    const waitHoursByProcess = {
      IMPRIMACION: 12,
      PINTURA: 12,
      CNC: 0,
    };
    expect(dryWaitHoursForProcess("PINTURA", waitHoursByProcess)).toBe(12);
    expect(dryWaitHoursForProcess("CNC", waitHoursByProcess)).toBe(0);
    expect(dryWaitHoursForProcess("ENSAMBLAJE", waitHoursByProcess)).toBe(0);
  });
});

describe("aggregateTasksByProcess", () => {
  it("sums hours for repeated processes", () => {
    const rows = aggregateTasksByProcess([
      {
        id: "1",
        process: "CNC",
        estimatedHours: 1.7,
        doneHours: 0,
        pendingHours: 1.7,
        order: 0,
      },
      {
        id: "2",
        process: "CNC",
        estimatedHours: 1.7,
        doneHours: 0.5,
        pendingHours: 1.2,
        order: 1000,
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.estimatedHours).toBeCloseTo(3.4);
    expect(rows[0]?.doneHours).toBeCloseTo(0.5);
    expect(rows[0]?.units).toBe(2);
  });
});

describe("lampElementsToConfig", () => {
  it("groups physical elements by element type", () => {
    const configs = lampElementsToConfig([
      {
        elementTypeId: "ft1",
        surfaceM2: 4,
        elementType: { typology: ElementTypology.BASTIDOR },
      },
      {
        elementTypeId: "ft1",
        surfaceM2: 4,
        elementType: { typology: ElementTypology.BASTIDOR },
      },
      {
        elementTypeId: "ft2",
        surfaceM2: 2,
        elementType: { typology: ElementTypology.ILUMINACION },
      },
    ]);
    expect(configs).toHaveLength(2);
    const sol = configs.find((c) => c.elementTypeId === "ft1");
    expect(sol?.units).toBe(2);
    expect(sol?.surfaceM2).toBe(4);
  });
});

describe("groupTasksByBastidor", () => {
  it("groups units under the same frame type", () => {
    const elementType = { id: "ft1", name: "Elemento Sol" };
    const groups = groupTasksByBastidor([
      {
        order: 0,
        lampElement: {
          id: "lf1",
          label: "Elemento Sol 1",
          surfaceM2: 4,
          elementType,
        },
      },
      {
        order: 1000,
        lampElement: {
          id: "lf2",
          label: "Elemento Sol 2",
          surfaceM2: 4,
          elementType,
        },
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.unitCount).toBe(2);
    expect(groups[0]?.tasks).toHaveLength(2);
  });

  it("keeps element groups stable and places sin-elemento last", () => {
    const groups = groupTasksByBastidor([
      {
        order: 0,
        lampElement: null,
      },
      {
        order: 5,
        lampElement: {
          id: "b",
          label: "Panel",
          surfaceM2: 2,
          elementType: { id: "et-b", name: "Bastidor" },
        },
      },
      {
        order: 1,
        lampElement: {
          id: "a",
          label: "Luz",
          surfaceM2: 1,
          elementType: { id: "et-a", name: "Iluminacion" },
        },
      },
    ]);
    expect(groups.map((g) => g.key)).toEqual([
      "et-b",
      "et-a",
      "__sin_elemento__",
    ]);
  });
});

describe("getNextOrderInChain", () => {
  it("returns max order + 1 for the chain", async () => {
    const { getNextOrderInChain } = await import("@/features/projects/lamp-tasks");
    const tx = {
      task: {
        aggregate: async () => ({ _max: { order: 3 } }),
      },
    };
    await expect(getNextOrderInChain(tx as never, "lamp-1", "el-1")).resolves.toBe(4);
    await expect(getNextOrderInChain(tx as never, "lamp-1", null)).resolves.toBe(4);
  });

  it("returns 0 when the chain is empty", async () => {
    const { getNextOrderInChain } = await import("@/features/projects/lamp-tasks");
    const tx = {
      task: {
        aggregate: async () => ({ _max: { order: null } }),
      },
    };
    await expect(getNextOrderInChain(tx as never, "lamp-1", null)).resolves.toBe(0);
  });
});
