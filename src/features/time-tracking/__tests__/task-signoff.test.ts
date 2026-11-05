import { describe, expect, it } from "vitest";
import { resolveCompletion } from "../task-signoff";

const base = { executorIds: ["ana", "luis"], signedIds: [] as string[] };

describe("resolveCompletion", () => {
  it("tarea normal: el responsable la cierra", () => {
    expect(resolveCompletion({ ...base, requiredWorkers: 1, personId: "ana" })).toBe("close");
  });

  it("tarea normal: el apoyo nunca la da por terminada", () => {
    expect(resolveCompletion({ ...base, requiredWorkers: 1, personId: "luis" })).toBe("forbidden");
  });

  it("chapas: la primera firma no cierra, la segunda sí (da igual quién empiece)", () => {
    const first = resolveCompletion({ ...base, requiredWorkers: 2, personId: "luis" });
    expect(first).toBe("signoff");
    const second = resolveCompletion({ ...base, requiredWorkers: 2, personId: "ana", signedIds: ["luis"] });
    expect(second).toBe("close");
  });

  it("chapas: quien ya firmó no cuenta dos veces", () => {
    expect(
      resolveCompletion({ ...base, requiredWorkers: 2, personId: "ana", signedIds: ["ana"] }),
    ).toBe("signoff");
  });

  it("OT con un solo operario o sin elegidos: se cierra como siempre", () => {
    expect(resolveCompletion({ requiredWorkers: 2, executorIds: ["ana"], personId: "ana", signedIds: [] })).toBe("close");
    expect(resolveCompletion({ requiredWorkers: 1, executorIds: [], personId: "ana", signedIds: [] })).toBe("close");
  });

  it("quien no es operario de la OT (admin, sin ficha) la cierra", () => {
    expect(resolveCompletion({ ...base, requiredWorkers: 2, personId: "admin" })).toBe("close");
    expect(resolveCompletion({ ...base, requiredWorkers: 1, personId: null })).toBe("close");
  });
});
