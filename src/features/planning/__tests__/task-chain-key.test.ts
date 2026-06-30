import { describe, expect, it } from "vitest";
import { taskChainKey } from "@/features/planning/task-chain-key";

describe("taskChainKey", () => {
  it("uses lampElementId when present", () => {
    expect(
      taskChainKey({ lampId: "lamp-1", lampElementId: "elem-a" }),
    ).toBe("elem-a");
  });

  it("falls back to lampId for manual lamps", () => {
    expect(taskChainKey({ lampId: "lamp-1", lampElementId: null })).toBe(
      "lamp-1",
    );
    expect(taskChainKey({ lampId: "lamp-1" })).toBe("lamp-1");
  });
});
