import { describe, expect, it } from "vitest";
import { businessDaysInMonth, monthCalendarWeeks } from "../civil-date";

describe("vista mes con sábados trabajados", () => {
  it("sin sábados trabajados: filas de lunes a viernes", () => {
    const weeks = monthCalendarWeeks("2026-10-01");
    expect(weeks.every((w) => w.length === 5)).toBe(true);
    expect(businessDaysInMonth("2026-10-01")).not.toContain("2026-10-31");
  });

  it("con un sábado trabajado: sexta columna solo con ese sábado", () => {
    const weeks = monthCalendarWeeks("2026-10-01", new Set(["2026-10-31"]));
    expect(weeks.every((w) => w.length === 6)).toBe(true);
    const saturdays = weeks.map((w) => w[5]?.iso ?? null).filter(Boolean);
    expect(saturdays).toEqual(["2026-10-31"]);
    // La semana del 26/10 lleva del lunes al sábado en la misma fila.
    const last = weeks.at(-1)!;
    expect(last[0]?.iso).toBe("2026-10-26");
    expect(last[5]?.iso).toBe("2026-10-31");
    expect(businessDaysInMonth("2026-10-01", new Set(), new Set(["2026-10-31"]))).toContain("2026-10-31");
  });
});
