import { describe, expect, it } from "vitest";
import { ElementTypology } from "@/generated/prisma";
import {
  describeNaveAssignment,
  elementTaskScopeWhere,
  elementTypeIdFromGroupKey,
  formatNaveLabel,
  isCustomNaveAssignment,
  MANUAL_ELEMENT_KEY,
  resolveEffectiveElementTypeNaveId,
  resolveNaveForElementType,
  summarizeNaveIds,
} from "@/features/projects/task-nave";

describe("resolveEffectiveElementTypeNaveId", () => {
  const typologyDefaults = new Map([[ElementTypology.BASTIDOR, "nave-bastidor"]]);

  it("prefers explicit element type override over typology", () => {
    expect(
      resolveEffectiveElementTypeNaveId({
        elementTypeId: "et-1",
        elementTypeDefaultNaveId: "nave-custom",
        elementTypeTypology: ElementTypology.BASTIDOR,
        elementTypeDefaultNaves: new Map(),
        typologyDefaultNaves: typologyDefaults,
        fallbackNaveId: "fallback",
      }),
    ).toBe("nave-custom");
  });

  it("falls back to typology default when element type has no override", () => {
    expect(
      resolveEffectiveElementTypeNaveId({
        elementTypeId: "et-1",
        elementTypeDefaultNaveId: null,
        elementTypeTypology: ElementTypology.BASTIDOR,
        elementTypeDefaultNaves: new Map(),
        typologyDefaultNaves: typologyDefaults,
        fallbackNaveId: "fallback",
      }),
    ).toBe("nave-bastidor");
  });
});

describe("resolveNaveForElementType", () => {
  const defaults = new Map([
    ["et-bastidor", "nave-bastidor"],
    ["et-tela", "nave-tela"],
  ]);

  it("uses element type default when available", () => {
    expect(
      resolveNaveForElementType("et-bastidor", defaults, "fallback"),
    ).toBe("nave-bastidor");
  });

  it("falls back when element type has no default", () => {
    expect(resolveNaveForElementType("et-other", defaults, "fallback")).toBe(
      "fallback",
    );
  });

  it("uses fallback for manual tasks without element type", () => {
    expect(resolveNaveForElementType(null, defaults, "fallback")).toBe(
      "fallback",
    );
  });
});

describe("isCustomNaveAssignment", () => {
  it("detects custom nave assignments", () => {
    expect(isCustomNaveAssignment("n2", "n1")).toBe(true);
    expect(isCustomNaveAssignment("n1", "n1")).toBe(false);
    expect(isCustomNaveAssignment("n1", null)).toBe(false);
  });
});

describe("describeNaveAssignment", () => {
  it("labels default, custom and mixed assignments", () => {
    expect(
      describeNaveAssignment({
        naveIds: ["n1", "n1"],
        elementTypeDefaultNaveId: "n1",
      }),
    ).toBe("default");
    expect(
      describeNaveAssignment({
        naveIds: ["n2"],
        elementTypeDefaultNaveId: "n1",
      }),
    ).toBe("custom");
    expect(
      describeNaveAssignment({
        naveIds: ["n1", "n2"],
        elementTypeDefaultNaveId: "n1",
      }),
    ).toBe("mixed");
  });
});

describe("summarizeNaveIds", () => {
  const navesById = new Map([
    ["n1", { id: "n1", codigo: "N1", nombre: "Nave 1" }],
    ["n2", { id: "n2", codigo: "N2", nombre: "Nave 2" }],
  ]);

  it("returns homogeneous label for a single nave", () => {
    expect(summarizeNaveIds(["n1", "n1"], navesById)).toEqual({
      label: "N1 · Nave 1",
      homogeneous: true,
      naveId: "n1",
    });
  });

  it("returns Mixto when naves differ", () => {
    expect(summarizeNaveIds(["n1", "n2"], navesById)).toEqual({
      label: "Mixto",
      homogeneous: false,
      naveId: null,
    });
  });
});

describe("elementTypeIdFromGroupKey", () => {
  it("maps manual element key to null", () => {
    expect(elementTypeIdFromGroupKey(MANUAL_ELEMENT_KEY)).toBeNull();
  });

  it("keeps element type ids", () => {
    expect(elementTypeIdFromGroupKey("element-1")).toBe("element-1");
  });
});

describe("elementTaskScopeWhere", () => {
  it("scopes manual lamps without lampElement", () => {
    expect(
      elementTaskScopeWhere({
        lampId: "l1",
        elementTypeId: null,
        process: "CNC",
      }),
    ).toEqual({
      lampId: "l1",
      process: "CNC",
      lampElementId: null,
    });
  });

  it("scopes tasks by element type", () => {
    expect(
      elementTaskScopeWhere({
        lampId: "l1",
        elementTypeId: "et1",
      }),
    ).toEqual({
      lampId: "l1",
      lampElement: { elementTypeId: "et1" },
    });
  });
});

describe("formatNaveLabel", () => {
  it("formats known nave labels", () => {
    expect(
      formatNaveLabel({ id: "n1", codigo: "N1", nombre: "Nave 1" }, "n1"),
    ).toBe("N1 · Nave 1");
  });
});
