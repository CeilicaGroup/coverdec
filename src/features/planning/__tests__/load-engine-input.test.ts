import { describe, expect, it } from "vitest";
import { effectivePendingHours } from "../load-engine-input";

describe("effectivePendingHours", () => {
  it("returns 0 for a completed task (pendingHours=0)", () => {
    expect(
      effectivePendingHours({ pendingHours: 0, doneHours: 8, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns 0 for a task where doneHours >= estimatedHours", () => {
    expect(
      effectivePendingHours({ pendingHours: 2, doneHours: 8, estimatedHours: 8 }),
    ).toBe(0);
  });

  it("returns pendingHours when it is smaller than remaining (horas ya comprometidas en semanas previas)", () => {
    // Tarea de 8h; 5h planificadas en semana 1 → pendingHours=3.
    // Sin horas hechas aún. effectivePendingHours debe devolver 3, no 8.
    expect(
      effectivePendingHours({ pendingHours: 3, doneHours: 0, estimatedHours: 8 }),
    ).toBe(3);
  });

  it("caps pendingHours by remaining when doneHours has increased", () => {
    // pendingHours=6 pero ya se han hecho 4h → solo quedan 4h físicamente.
    expect(
      effectivePendingHours({ pendingHours: 6, doneHours: 4, estimatedHours: 8 }),
    ).toBe(4);
  });

  it("returns pendingHours when it equals remaining (tarea nueva sin planificar)", () => {
    expect(
      effectivePendingHours({ pendingHours: 8, doneHours: 0, estimatedHours: 8 }),
    ).toBe(8);
  });
});
