import { describe, expect, it } from "vitest";
import { ElementRouteType } from "@/generated/prisma";
import { applySeqRoutePrecedence } from "../seq-route-precedence";

describe("applySeqRoutePrecedence", () => {
  const naveCodigoById = new Map([
    ["n1", "N1"],
    ["n2", "N2"],
    ["n3", "N3"],
  ]);

  it("boosts N2 min quarter to max N3 when lamp is SEQ_N3_N2", () => {
    const tasks = [
      { id: "t-n3", lampId: "l1", naveId: "n3", minWeekQuarter: 2 },
      { id: "t-n2", lampId: "l1", naveId: "n2", minWeekQuarter: 1 },
    ];
    const minByTask = new Map([
      ["t-n3", 2],
      ["t-n2", 1],
    ]);
    const lampRouteByLampId = new Map([
      ["l1", { routeType: ElementRouteType.SEQ_N3_N2 }],
    ]);

    const result = applySeqRoutePrecedence({
      tasks,
      minByTask,
      lampRouteByLampId,
      naveCodigoById,
    });

    expect(result.get("t-n2")).toBe(2);
    expect(result.get("t-n3")).toBe(2);
  });

  it("does not change parallel routes", () => {
    const tasks = [
      { id: "t-n3", lampId: "l1", naveId: "n3", minWeekQuarter: 2 },
      { id: "t-n2", lampId: "l1", naveId: "n2", minWeekQuarter: 1 },
    ];
    const minByTask = new Map([
      ["t-n3", 2],
      ["t-n2", 1],
    ]);
    const lampRouteByLampId = new Map([
      ["l1", { routeType: ElementRouteType.PARALLEL }],
    ]);

    const result = applySeqRoutePrecedence({
      tasks,
      minByTask,
      lampRouteByLampId,
      naveCodigoById,
    });

    expect(result.get("t-n2")).toBe(1);
  });
});
