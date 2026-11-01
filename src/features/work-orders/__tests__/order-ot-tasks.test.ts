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

  it("la entrega más urgente va primero en la OT; sin fecha, al final", () => {
    const base = { lampElementId: null, order: 0 };
    const tasks = [
      { ...base, id: "sin-fecha", projectId: "p-a", lampId: "l-a", deliveryDate: null },
      { ...base, id: "noviembre-20", projectId: "p-b", lampId: "l-b", deliveryDate: new Date("2026-11-20") },
      { ...base, id: "noviembre-01", projectId: "p-z", lampId: "l-z", deliveryDate: new Date("2026-11-01") },
    ];
    expect(sortTaskIdsForWorkOrderSequence(tasks)).toEqual(["noviembre-01", "noviembre-20", "sin-fecha"]);
  });
});
