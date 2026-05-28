import { describe, expect, it } from "vitest";
import { resolveImportProcessCode } from "../resolve-import-process";

describe("resolveImportProcessCode", () => {
  it("maps known aliases", () => {
    expect(resolveImportProcessCode("Pintura")).toBe("PINTURA");
  });

  it("derives code from unknown labels", () => {
    expect(resolveImportProcessCode("Mi proceso custom")).toBe(
      "MI_PROCESO_CUSTOM",
    );
  });

  it("returns null for empty input", () => {
    expect(resolveImportProcessCode("   ")).toBeNull();
  });
});
