import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_STRATEGY,
  DEFAULT_PLANNING_WEIGHTS,
  PLANNING_STRATEGY_PRESETS,
  normalizePlanningWeights,
  strategyToWeights,
  weightsToStrategy,
} from "../policy-schema";

describe("normalizePlanningWeights", () => {
  it("fills wLaborCost when missing from legacy rows", () => {
    const w = normalizePlanningWeights({
      wLate: 2,
      wUnscheduled: 2,
      wLoadBalance: 1,
      wMove: 1,
    });
    expect(w.wLaborCost).toBe(DEFAULT_PLANNING_WEIGHTS.wLaborCost);
  });
});

describe("planning strategy mapping", () => {
  it("maps on-time preset to high wLate and low wLaborCost", () => {
    const w = strategyToWeights(PLANNING_STRATEGY_PRESETS.onTime);
    expect(w.wLate).toBe(5);
    expect(w.wLaborCost).toBe(0);
    expect(w.wUnscheduled).toBeGreaterThanOrEqual(w.wLate);
  });

  it("maps min-cost preset to low wLate and high wLaborCost", () => {
    const w = strategyToWeights(PLANNING_STRATEGY_PRESETS.minCost);
    expect(w.wLate).toBe(0);
    expect(w.wLaborCost).toBe(5);
  });

  it("round-trips strategy through weights approximately", () => {
    const back = weightsToStrategy(strategyToWeights(DEFAULT_PLANNING_STRATEGY));
    expect(back.deliveryPriority).toBe(50);
    expect(back.costPriority).toBe(50);
  });
});
