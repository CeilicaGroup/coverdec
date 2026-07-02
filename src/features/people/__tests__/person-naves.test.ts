import { describe, expect, it } from "vitest";
import { assertSingleNaveId, pickCanonicalPersonNave } from "@/features/people/person-naves";

describe("person-naves", () => {
  it("accepts exactly one nave id", () => {
    expect(assertSingleNaveId(["nave-a"])).toBe("nave-a");
  });

  it("deduplicates a single repeated nave id", () => {
    expect(assertSingleNaveId(["nave-a", "nave-a"])).toBe("nave-a");
  });

  it("rejects zero naves", () => {
    expect(() => assertSingleNaveId([])).toThrow(
      "Cada operario debe tener exactamente una nave asignada.",
    );
  });

  it("rejects more than one nave", () => {
    expect(() => assertSingleNaveId(["nave-a", "nave-b"])).toThrow(
      "Cada operario debe tener exactamente una nave asignada.",
    );
  });
});

describe("pickCanonicalPersonNave", () => {
  it("picks the nave with lowest codigo when legacy rows exist", () => {
    const picked = pickCanonicalPersonNave([
      { naveId: "n2", nave: { codigo: "N2", nombre: "Dos" } },
      { naveId: "n1", nave: { codigo: "N1", nombre: "Uno" } },
    ]);
    expect(picked?.naveId).toBe("n1");
  });
});
