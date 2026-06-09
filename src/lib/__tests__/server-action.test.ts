import { describe, expect, it, vi } from "vitest";
import { runServerAction } from "@/lib/server-action";

vi.mock("@/lib/logger", () => ({
  childLogger: () => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe("runServerAction", () => {
  it("returns ok with data on success", async () => {
    const result = await runServerAction("test.ok", async () => ({ id: "1" }));
    expect(result).toEqual({ ok: true, data: { id: "1" } });
  });

  it("returns explicit error message for thrown business errors", async () => {
    const result = await runServerAction("test.fail", async () => {
      throw new Error("Registro no encontrado.");
    });
    expect(result).toEqual({ ok: false, error: "Registro no encontrado." });
  });

  it("maps generic Next.js errors to a friendly message", async () => {
    const result = await runServerAction("test.generic", async () => {
      throw new Error(
        "An error occurred in the Server Components render. The specific message is omitted in production builds.",
      );
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Recarga la página");
    }
  });
});
