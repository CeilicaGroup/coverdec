import { describe, expect, it } from "vitest";
import {
  buildUnscheduledPlanningSummary,
  planningErrorFromMessage,
} from "@/features/planning/planning-generation-error";

describe("buildUnscheduledPlanningSummary", () => {
  it("keeps the summary short and omits Quedan Xh motivos", () => {
    const summary = buildUnscheduledPlanningSummary({
      totalUnplaced: 256.75,
      warningCount: 135,
      deferredHours: 0,
    });
    expect(summary).toContain("capacidad insuficiente");
    expect(summary).toContain("256.8h sin asignar en 135 tarea(s)");
    expect(summary).not.toContain("Motivos principales");
    expect(summary).not.toContain("Quedan");
  });

  it("mentions plan-from window when only Friday remains", () => {
    const summary = buildUnscheduledPlanningSummary({
      totalUnplaced: 40,
      warningCount: 10,
      deferredHours: 0,
      firstSchedulableDayIndex: 4,
    });
    expect(summary).toContain("1 día planificable");
    expect(summary).toContain("viernes");
    expect(summary).toContain("Planificar desde");
  });
});

describe("planningErrorFromMessage", () => {
  it("splits multi-line solver errors into summary and warnings", () => {
    const err = planningErrorFromMessage("Resumen corto\nDetalle A\nDetalle B");
    expect(err.summary).toBe("Resumen corto");
    expect(err.warnings).toEqual(["Detalle A", "Detalle B"]);
    expect(err.message).toBe("Resumen corto");
  });
});
