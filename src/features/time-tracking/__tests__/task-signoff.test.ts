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

  it("chapas asignadas por el planning (sin operarios elegidos en la OT): firman los dos planificados", () => {
    const planned = { requiredWorkers: 2, executorIds: [] as string[], plannedIds: ["ana", "luis"] };
    expect(resolveCompletion({ ...planned, personId: "ana", signedIds: [] })).toBe("signoff");
    expect(resolveCompletion({ ...planned, personId: "luis", signedIds: ["ana"] })).toBe("close");
  });

  it("chapas con una sola persona planificada o quien completa no está asignado: se cierra", () => {
    expect(resolveCompletion({ requiredWorkers: 2, executorIds: [], plannedIds: ["ana"], personId: "ana", signedIds: [] })).toBe("close");
    expect(resolveCompletion({ requiredWorkers: 2, executorIds: [], plannedIds: ["ana", "luis"], personId: "otro", signedIds: [] })).toBe("close");
  });

  it("junta elegidos de la OT y planificados sin duplicar", () => {
    const p = { requiredWorkers: 2, executorIds: ["ana"], plannedIds: ["ana", "luis"] };
    expect(resolveCompletion({ ...p, personId: "luis", signedIds: [] })).toBe("signoff");
    expect(resolveCompletion({ ...p, personId: "ana", signedIds: ["luis"] })).toBe("close");
  });
});
