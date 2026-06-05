import { describe, expect, it } from "vitest";
import {
  assertLampNameAllowed,
  classifyLampNameConflict,
  isPrismaUniqueViolation,
  normalizeLampName,
  parseSimilarLampNameError,
  similarLampNameError,
} from "@/features/projects/lamp-name-validation";

describe("normalizeLampName", () => {
  it("normalizes case, accents and spacing", () => {
    expect(normalizeLampName("  Lámpara   Sol  ")).toBe("lampara sol");
  });
});

describe("classifyLampNameConflict", () => {
  const existing = [
    { id: "1", name: "Panel Sol" },
    { id: "2", name: "Panel Luna" },
  ];

  it("detects identical names after normalization", () => {
    expect(classifyLampNameConflict("  PANEL   sol ", existing)).toEqual({
      level: "identical",
      matches: ["Panel Sol"],
    });
  });

  it("detects similar names", () => {
    const result = classifyLampNameConflict("Panel Sol 2", existing);
    expect(result.level).toBe("similar");
    expect(result.matches).toContain("Panel Sol");
  });

  it("returns none for clearly different names", () => {
    expect(classifyLampNameConflict("Otro producto", existing)).toEqual({
      level: "none",
      matches: [],
    });
  });

  it("ignores the lamp being renamed", () => {
    expect(
      classifyLampNameConflict("Panel Sol", existing, "1"),
    ).toEqual({
      level: "none",
      matches: [],
    });
  });
});

describe("similarLampNameError", () => {
  it("round-trips through parseSimilarLampNameError", () => {
    const error = similarLampNameError(["Panel Sol", "Panel Sol 2"]);
    expect(parseSimilarLampNameError(error.message)).toEqual([
      "Panel Sol",
      "Panel Sol 2",
    ]);
  });
});

describe("assertLampNameAllowed", () => {
  const mockDb = {
    lamp: {
      findMany: async () => [{ id: "1", name: "Panel Sol" }],
    },
  } as Pick<import("@/generated/prisma").PrismaClient, "lamp">;

  it("blocks identical names", async () => {
    await expect(
      assertLampNameAllowed(mockDb, {
        projectId: "p1",
        name: "panel sol",
      }),
    ).rejects.toThrow(/Ya existe una lámpara llamada/);
  });

  it("requires confirmation for similar names", async () => {
    await expect(
      assertLampNameAllowed(mockDb, {
        projectId: "p1",
        name: "Panel Sol 2",
      }),
    ).rejects.toThrow(/^LAMP_NAME_SIMILAR:/);
  });

  it("allows similar names when confirmSimilarName is true", async () => {
    await expect(
      assertLampNameAllowed(mockDb, {
        projectId: "p1",
        name: "Panel Sol 2",
        confirmSimilarName: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("isPrismaUniqueViolation", () => {
  it("detects Prisma P2002 errors", () => {
    expect(isPrismaUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isPrismaUniqueViolation({ code: "P2003" })).toBe(false);
    expect(isPrismaUniqueViolation(new Error("fail"))).toBe(false);
  });
});
