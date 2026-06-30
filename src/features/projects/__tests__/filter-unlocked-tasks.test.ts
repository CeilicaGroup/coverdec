import { describe, expect, it } from "vitest";
import { filterUnlockedTasks } from "@/features/projects/lamp-tasks";

describe("filterUnlockedTasks", () => {
  it("unlocks first process of each element independently", () => {
    const tasks = [
      {
        id: "e1-cnc",
        lampId: "l1",
        lampElementId: "elem-1",
        order: 0,
        pendingHours: 4,
      },
      {
        id: "e1-lij",
        lampId: "l1",
        lampElementId: "elem-1",
        order: 1,
        pendingHours: 2,
      },
      {
        id: "e2-cnc",
        lampId: "l1",
        lampElementId: "elem-2",
        order: 1000,
        pendingHours: 4,
      },
    ];

    const unlocked = filterUnlockedTasks(tasks);
    expect(unlocked.map((t) => t.id).sort()).toEqual(["e1-cnc", "e2-cnc"]);
  });
});
