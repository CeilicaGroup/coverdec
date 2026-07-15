import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import { productiveTaskSystemKindWhere } from "@/features/planning/productive-task-filter";

describe("productiveTaskSystemKindWhere", () => {
  it("incluye null y excluye AD_HOC", () => {
    expect(productiveTaskSystemKindWhere()).toEqual({
      OR: [
        { systemKind: null },
        { systemKind: { not: TaskSystemKind.AD_HOC } },
      ],
    });
  });

  it("acepta tareas legacy sin systemKind", () => {
    const matches = (systemKind: TaskSystemKind | null) =>
      systemKind === null || systemKind !== TaskSystemKind.AD_HOC;

    expect(matches(null)).toBe(true);
    expect(matches(TaskSystemKind.AD_HOC)).toBe(false);
  });
});
