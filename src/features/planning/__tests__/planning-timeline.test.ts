import { describe, expect, it } from "vitest";
import { buildPlanningTimeline } from "../planning-timeline";
import type { ProcessCode } from "@/types/process";

const processByCode = new Map([
  ["IMPRIMACION", { waitHours: 12 }],
  ["PINTURA", { waitHours: 12 }],
  ["LIJADO", { waitHours: 0 }],
  ["CNC", { waitHours: 0 }],
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
      notes: null,
      systemKind: null,
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

  it("shows 12h dry window in Horario, not the calendar gap to successor (PL-08)", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          taskId: "imp",
          order: 0,
          process: "IMPRIMACION",
          date: new Date("2026-06-11T00:00:00.000Z"),
          startSlot: 6,
          endSlot: 6.25,
        }),
        slice({
          taskId: "paint",
          order: 1,
          process: "PINTURA",
          date: new Date("2026-06-12T00:00:00.000Z"),
          startSlot: 6,
          endSlot: 6.25,
        }),
      ],
      processByCode,
    );
    const dry = items.find((i) => i.kind === "dry-wait");
    expect(dry?.kind === "dry-wait" && dry.scheduleLabel).toContain("15.25h →");
    expect(dry?.kind === "dry-wait" && dry.scheduleLabel).toContain("12/06/2026 3.25h");
    expect(dry?.kind === "dry-wait" && dry.scheduleLabel).not.toContain(
      "12/06/2026 15h",
    );
    expect(dry?.kind === "dry-wait" && dry.scheduleLabel).toContain(
      "PINTURA planificada",
    );
  });

  it("uses full lamp chain so dry-wait appears before unassigned intermediate task", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          taskId: "imp",
          order: 0,
          process: "IMPRIMACION",
          date: new Date("2026-06-10T00:00:00.000Z"),
          startSlot: 6,
          endSlot: 7,
        }),
        slice({
          taskId: "paint",
          order: 2,
          process: "PINTURA",
          date: new Date("2026-06-12T00:00:00.000Z"),
          startSlot: 6,
          endSlot: 6.25,
        }),
      ],
      processByCode,
      [
        { id: "imp", lampId: "l1", order: 0, process: "IMPRIMACION" },
        { id: "cnc", lampId: "l1", order: 1, process: "CNC" },
        { id: "paint", lampId: "l1", order: 2, process: "PINTURA" },
      ],
    );
    const dry = items.filter((i) => i.kind === "dry-wait");
    const dryImpCnc = dry.find(
      (item) => item.kind === "dry-wait" && item.id === "dry-l1-imp-cnc",
    );
    expect(dryImpCnc?.kind).toBe("dry-wait");
    expect(dryImpCnc?.scheduleLabel).toContain("mín. 12h");
  });

  it("orders dry-wait chronologically with same-day assignments", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          id: "a-morning",
          taskId: "morning",
          order: 0,
          process: "CNC",
          date: new Date("2026-06-10T00:00:00.000Z"),
          startSlot: 8,
          endSlot: 9,
        }),
        slice({
          id: "a-imp",
          taskId: "imp",
          order: 1,
          process: "IMPRIMACION",
          date: new Date("2026-06-10T00:00:00.000Z"),
          startSlot: 10,
          endSlot: 10.5,
        }),
        slice({
          id: "a-noon",
          taskId: "noon",
          order: 2,
          process: "CNC",
          date: new Date("2026-06-10T00:00:00.000Z"),
          startSlot: 12,
          endSlot: 13,
        }),
      ],
      processByCode,
      [
        { id: "morning", lampId: "l1", order: 0, process: "CNC" },
        { id: "imp", lampId: "l1", order: 1, process: "IMPRIMACION" },
        { id: "noon", lampId: "l1", order: 2, process: "CNC" },
      ],
    );

    const signature = items.map((item) =>
      item.kind === "work" ? item.assignment.id : item.id,
    );
    expect(signature).toEqual([
      "a-morning",
      "a-imp",
      "dry-l1-imp-noon",
      "a-noon",
    ]);
  });

  it("uses lamp context from each chain", () => {
    const items = buildPlanningTimeline(
      [
        slice({
          id: "a-l1-imp",
          taskId: "l1-imp",
          lampId: "l1",
          order: 0,
          process: "IMPRIMACION",
        }),
        slice({
          id: "a-l1-paint",
          taskId: "l1-paint",
          lampId: "l1",
          order: 1,
          process: "PINTURA",
        }),
        {
          ...slice({
            id: "a-l2-imp",
            taskId: "l2-imp",
            lampId: "l2",
            order: 0,
            process: "IMPRIMACION",
          }),
          task: {
            ...slice({
              id: "a-l2-imp",
              taskId: "l2-imp",
              lampId: "l2",
              order: 0,
              process: "IMPRIMACION",
            }).task,
            lamp: { name: "L2" },
          },
        },
        {
          ...slice({
            id: "a-l2-paint",
            taskId: "l2-paint",
            lampId: "l2",
            order: 1,
            process: "PINTURA",
          }),
          task: {
            ...slice({
              id: "a-l2-paint",
              taskId: "l2-paint",
              lampId: "l2",
              order: 1,
              process: "PINTURA",
            }).task,
            lamp: { name: "L2" },
          },
        },
      ],
      processByCode,
      [
        { id: "l1-imp", lampId: "l1", order: 0, process: "IMPRIMACION" },
        { id: "l1-paint", lampId: "l1", order: 1, process: "PINTURA" },
        { id: "l2-imp", lampId: "l2", order: 0, process: "IMPRIMACION" },
        { id: "l2-paint", lampId: "l2", order: 1, process: "PINTURA" },
      ],
    );

    const waits = items.filter((item) => item.kind === "dry-wait");
    const l1Wait = waits.find((item) => item.kind === "dry-wait" && item.lampId === "l1");
    const l2Wait = waits.find((item) => item.kind === "dry-wait" && item.lampId === "l2");

    expect(l1Wait?.kind === "dry-wait" && l1Wait.lampName).toBe("L1");
    expect(l2Wait?.kind === "dry-wait" && l2Wait.lampName).toBe("L2");
  });
});
