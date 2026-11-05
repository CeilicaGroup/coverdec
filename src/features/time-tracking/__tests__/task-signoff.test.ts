import { describe, expect, it } from "vitest";
import { resolveCompletion } from "../task-signoff";

const base = { executorIds: ["ana", "luis"], signedIds: [] as string[] };

describe("resolveCompletion", () => {
  it("tarea normal: el responsable la cierra", () => {
    expect(resolveCompletion({ ...base, signoffAll: false, personId: "ana" })).toBe("close");
  });

  it("tarea normal: el apoyo nunca la da por terminada", () => {
    expect(resolveCompletion({ ...base, signoffAll: false, personId: "luis" })).toBe("forbidden");
  });

  it("firman todos: la primera firma no cierra, la segunda sí (da igual quién empiece)", () => {
    expect(resolveCompletion({ ...base, signoffAll: true, personId: "luis" })).toBe("signoff");
    expect(resolveCompletion({ ...base, signoffAll: true, personId: "ana", signedIds: ["luis"] })).toBe("close");
  });

  it("firman todos: quien ya firmó no cuenta dos veces", () => {
    expect(resolveCompletion({ ...base, signoffAll: true, personId: "ana", signedIds: ["ana"] })).toBe("signoff");
  });

  it("firman todos pero la OT tiene un solo operario o ninguno: se cierra como siempre", () => {
    expect(resolveCompletion({ signoffAll: true, executorIds: ["ana"], personId: "ana", signedIds: [] })).toBe("close");
    expect(resolveCompletion({ signoffAll: true, executorIds: [], personId: "ana", signedIds: [] })).toBe("close");
  });

  it("tarea normal sin operarios elegidos: se cierra como siempre", () => {
    expect(resolveCompletion({ signoffAll: false, executorIds: [], personId: "ana", signedIds: [] })).toBe("close");
  });

  it("quien no es operario de la OT (admin, sin ficha) la cierra", () => {
    expect(resolveCompletion({ ...base, signoffAll: true, personId: "admin" })).toBe("close");
    expect(resolveCompletion({ ...base, signoffAll: false, personId: null })).toBe("close");
  });

  it("firman todos con personas del planning (sin operarios elegidos en la OT): firman las dos planificadas", () => {
    const planned = { signoffAll: true, executorIds: [] as string[], plannedIds: ["ana", "luis"] };
    expect(resolveCompletion({ ...planned, personId: "ana", signedIds: [] })).toBe("signoff");
    expect(resolveCompletion({ ...planned, personId: "luis", signedIds: ["ana"] })).toBe("close");
  });

  it("firman todos con una sola persona planificada, o quien completa no está asignado: se cierra", () => {
    expect(resolveCompletion({ signoffAll: true, executorIds: [], plannedIds: ["ana"], personId: "ana", signedIds: [] })).toBe("close");
    expect(resolveCompletion({ signoffAll: true, executorIds: [], plannedIds: ["ana", "luis"], personId: "otro", signedIds: [] })).toBe("close");
  });

  it("junta elegidos de la OT y planificados sin duplicar", () => {
    const p = { signoffAll: true, executorIds: ["ana"], plannedIds: ["ana", "luis"] };
    expect(resolveCompletion({ ...p, personId: "luis", signedIds: [] })).toBe("signoff");
    expect(resolveCompletion({ ...p, personId: "ana", signedIds: ["luis"] })).toBe("close");
  });
});
