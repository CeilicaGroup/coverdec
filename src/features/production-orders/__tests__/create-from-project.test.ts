import { describe, expect, it } from "vitest";
import { ElementRouteType } from "@/generated/prisma";
import {
  buildPreviewsForLamp,
  estimateHoursForNaveKey,
  expandNaveKeysForRoute,
} from "@/features/production-orders/create-from-project";
import { detectN3ToN2Transfer } from "@/features/production-orders/route-meta";

const cruzElement = {
  id: "et-cruz",
  code: "LAMP-CRUZ",
  routeType: ElementRouteType.PARALLEL,
  routeNaves: ["N1", "N2", "N3"],
  seqPhases: null,
  processes: [
    { process: "CORTE_MANUAL", hoursPerUnit: 0.1, fixedHours: 0.2, notes: "N1", sequence: 0 },
    { process: "CNC", hoursPerUnit: 0.15, fixedHours: 0.4, notes: "N2", sequence: 1 },
    { process: "ENSAMBLAJE", hoursPerUnit: 0.2, fixedHours: 0.1, notes: "N3", sequence: 2 },
  ],
};

const selcosElement = {
  id: "et-selcos",
  code: "LAMP-SELCOS",
  routeType: ElementRouteType.SEQ_N3_N2,
  routeNaves: ["N1", "SEQ"],
  seqPhases: [
    { process: "ENSAMBLAJE", naveCodigo: "N3", sequence: 0, hoursPerUnit: 0.2, fixedHours: 0.1 },
    { process: "LIMPIEZA", naveCodigo: "N3", sequence: 1, hoursPerUnit: 0.1, fixedHours: 0.1 },
    { process: "ENSAMBLAJE", naveCodigo: "N2", sequence: 2, hoursPerUnit: 0.2, fixedHours: 0.1 },
  ],
  processes: [],
};

const lumElement = {
  id: "et-lum",
  code: "LAMP-LUM",
  routeType: ElementRouteType.PARALLEL,
  routeNaves: ["N1", "N3"],
  seqPhases: null,
  processes: [
    { process: "CORTE_MANUAL", hoursPerUnit: 0.1, fixedHours: 0.2, notes: "N1", sequence: 0 },
    { process: "ENSAMBLAJE", hoursPerUnit: 0.2, fixedHours: 0.1, notes: "N3", sequence: 1 },
  ],
};

describe("expandNaveKeysForRoute", () => {
  it("expands parallel route to 3 naves for Cruz", () => {
    expect(expandNaveKeysForRoute(ElementRouteType.PARALLEL, ["N1", "N2", "N3"])).toEqual([
      "N1",
      "N2",
      "N3",
    ]);
  });

  it("expands Selcos to N1 + SEQ", () => {
    expect(expandNaveKeysForRoute(ElementRouteType.SEQ_N3_N2, ["N1", "SEQ"])).toEqual([
      "N1",
      "SEQ",
    ]);
  });
});

describe("buildPreviewsForLamp", () => {
  it("generates 3 OP previews for Cruz", () => {
    const previews = buildPreviewsForLamp(
      {
        id: "lamp-1",
        name: "Cruz lobby",
        units: 5,
        ral: "9005",
        colorHex: null,
        elementType: cruzElement,
      },
      new Set(),
      new Map(),
    );
    expect(previews).toHaveLength(3);
    expect(previews.map((p) => p.naveKey).sort()).toEqual(["N1", "N2", "N3"]);
  });

  it("generates N1 + SEQ for Selcos", () => {
    const previews = buildPreviewsForLamp(
      {
        id: "lamp-2",
        name: "Selcos",
        units: 5,
        ral: "9010",
        colorHex: null,
        elementType: selcosElement,
      },
      new Set(),
      new Map(),
    );
    expect(previews).toHaveLength(2);
    expect(previews.map((p) => p.naveKey).sort()).toEqual(["N1", "SEQ"]);
  });

  it("generates N1 + N3 for Luminaria", () => {
    const previews = buildPreviewsForLamp(
      {
        id: "lamp-3",
        name: "Luminaria",
        units: 2,
        ral: "6018",
        colorHex: null,
        elementType: lumElement,
      },
      new Set(),
      new Map(),
    );
    expect(previews).toHaveLength(2);
    expect(previews.map((p) => p.naveKey).sort()).toEqual(["N1", "N3"]);
  });
});

describe("estimateHoursForNaveKey", () => {
  it("sums SEQ phase hours", () => {
    const { hours } = estimateHoursForNaveKey({
      naveKey: "SEQ",
      units: 2,
      elementType: selcosElement,
      seqPhases: selcosElement.seqPhases,
    });
    expect(hours).toBeGreaterThan(0);
  });
});

describe("detectN3ToN2Transfer", () => {
  it("detects transfer between last N3 and first N2 phase", () => {
    expect(
      detectN3ToN2Transfer({
        route: { seqPhases: selcosElement.seqPhases },
        completedStep: 1,
      }),
    ).toBe(true);
  });
});
