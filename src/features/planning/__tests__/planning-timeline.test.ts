import { describe, expect, it } from "vitest";
import { buildPlanningTimeline } from "../planning-timeline";
import type { ProcessCode } from "@/types/process";

const processByCode = new Map([
  ["IMPRIMACION", { waitHours: 12 }],
  ["PINTURA", { waitHours: 12 }],
  ["LIJADO", { waitHours: 0 }],
]);

function slice(
  overrides: Partial<{
    id: string;
    taskId: string;
    order: number;
    process: ProcessCode;
    lampId: string;
    date: Date;
    startSlot: number;
    endSlot: number;
  }>,
) {
  const taskId = overrides.taskId ?? "t1";
  return {
    id: overrides.id ?? `a-${taskId}`,
    date: overrides.date ?? new Date("2026-05-19T00:00:00.000Z"),
    startSlot: overrides.startSlot ?? 0,
    endSlot: overrides.endSlot ?? 2,
    hours: 2,
    process: overrides.process ?? "IMPRIMACION",
    personId: "p1",
    person: {
      id: "person-1",
      iniciales: "AB",
      color: "#000",
      alias: null,
      nombre: "Test",
    },
    task: {
      id: taskId,
      order: overrides.order ?? 0,
      isCompleted: false,
      projectId: "pr1",
      lampId: overrides.lampId ?? "l1",
      lamp: { name: "L1" },
      project: { name: "Proyecto" },
    },
  };
}

describe("buildPlanningTimeline", () => {
  it("inserts dry-wait after imprimación before pintura", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          taskId: "imp",
          order: 0,
          process: "IMPRIMACION",
          date: new Date("2026-05-19T00:00:00.000Z"),
          startSlot: 0,
          endSlot: 2,
        }),
        slice({
          taskId: "paint",
          order: 1,
          process: "PINTURA",
          date: new Date("2026-05-20T00:00:00.000Z"),
          startSlot: 0,
          endSlot: 2,
        }),
      ],
      processByCode,
    );
    const dry = items.filter((i) => i.kind === "dry-wait");
    expect(dry).toHaveLength(1);
    expect(dry[0]?.kind === "dry-wait" && dry[0].afterProcess).toBe(
      "IMPRIMACION",
    );
    expect(dry[0]?.kind === "dry-wait" && dry[0].waitHours).toBe(12);
  });

  it("skips dry-wait when waitHours is zero", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          taskId: "a",
          order: 0,
          process: "LIJADO",
        }),
        slice({
          taskId: "b",
          order: 1,
          process: "CNC",
        }),
      ],
      processByCode,
    );
    expect(items.every((i) => i.kind === "work")).toBe(true);
  });
});
