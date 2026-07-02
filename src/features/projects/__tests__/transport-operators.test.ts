import { describe, expect, it } from "vitest";
import {
  findTransportTasksWithoutEligibleOperator,
  formatMissingTransportOperatorError,
} from "@/features/projects/transport-operators";

describe("transport-operators", () => {
  const task = {
    id: "t1",
    naveId: "n1",
    nave: { codigo: "N1", nombre: "Nave 1" },
    project: { name: "Proyecto" },
    lamp: { name: "Lámpara" },
  };

  it("flags tasks when no operator is assigned in the nave", () => {
    const missing = findTransportTasksWithoutEligibleOperator({
      tasks: [task],
      peopleByNave: new Map(),
    });
    expect(missing).toHaveLength(1);
  });

  it("formats a readable planning error", () => {
    const message = formatMissingTransportOperatorError([task]);
    expect(message).toContain("TRANSPORTE");
    expect(message).toContain("Proyecto");
    expect(message).toContain("N1");
  });
});
