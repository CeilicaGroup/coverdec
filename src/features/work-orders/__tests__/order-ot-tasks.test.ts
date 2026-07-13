import { describe, expect, it } from "vitest";
import {
  sortTaskIdsForWorkOrderSequence,
  sortTasksForWorkOrderSequence,
} from "../order-ot-tasks";

describe("sortTasksForWorkOrderSequence", () => {
  it("orders by project, lamp, chain and process order", () => {
    const tasks = [
      {
        id: "t-l2",
        projectId: "p1",
        lampId: "l2",
        lampElementId: "le-2",
        order: 0,
      },
      {
        id: "t-l1",
        projectId: "p1",
        lampId: "l1",
        lampElementId: "le-1",
        order: 0,
      },
      {
        id: "t-l1-b",
        projectId: "p1",
        lampId: "l1",
        lampElementId: "le-1",
        order: 10,
      },
    ];

    expect(sortTaskIdsForWorkOrderSequence(tasks)).toEqual([
      "t-l1",
      "t-l1-b",
      "t-l2",
    ]);
  });

  it("aligns lamps across OT when sequences are assigned", () => {
    const tasks = sortTasksForWorkOrderSequence([
      {
        id: "a2",
        projectId: "p1",
        lampId: "lamp-2",
        lampElementId: "el-2",
        order: 0,
      },
      {
        id: "a1",
        projectId: "p1",
        lampId: "lamp-1",
        lampElementId: "el-1",
        order: 0,
      },
    ]);

    expect(tasks.map((task) => task.id)).toEqual(["a1", "a2"]);
  });
});
