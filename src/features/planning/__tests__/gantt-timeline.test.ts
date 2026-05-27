import { describe, expect, it } from "vitest";
import {
  buildContinuousTimeline,
  buildTaskTimelineBlocks,
  resolveBlockRange,
  toAxisFraction,
} from "@/features/planning/gantt-timeline";

const person = {
  id: "p1",
  iniciales: "AB",
  nombre: "Ana",
  color: "#000",
};

function assignment(
  startSlot: number,
  endSlot: number,
  hours: number,
  date = "2026-05-12T00:00:00.000Z",
) {
  return {
    taskId: "t1",
    personId: "p1",
    date: new Date(date),
    startSlot,
    endSlot,
    hours,
    process: "PINT",
    person,
    task: {
      id: "t1",
      projectId: "proj",
      project: { id: "proj", name: "Proyecto" },
      lamp: { id: "l1", name: "L1", frameType: { name: "Bastidor 1" } },
      lampFrame: null,
    },
  };
}

describe("gantt-timeline", () => {
  it("creates work fragments without gap waits between them", () => {
    const blocks = buildTaskTimelineBlocks(
      [assignment(0, 2, 2), assignment(4, 6, 2)],
      "t1",
      0,
      new Set(),
      "PINT",
    );

    expect(blocks.filter((b) => b.kind === "work")).toHaveLength(2);
    expect(blocks.some((b) => b.kind === "wait")).toBe(false);
  });

  it("adds process dry wait after last work fragment", () => {
    const blocks = buildTaskTimelineBlocks(
      [assignment(0, 2, 2)],
      "t1",
      24,
      new Set(),
      "PINT",
    );

    expect(blocks.filter((b) => b.kind === "work")).toHaveLength(1);
    const wait = blocks.find((b) => b.kind === "wait");
    expect(wait).toBeDefined();
    expect(wait?.label).toContain("PINT");
    expect(wait?.label).toContain("24h");
  });

  it("builds one continuous block for lamp/project envelope", () => {
    const blocks = buildContinuousTimeline(
      [
        {
          estimatedStart: "2026-05-12",
          estimatedEnd: "2026-05-13",
          startSlot: 0,
          endSlot: 4,
          process: "A",
          timelineBlocks: [
            {
              kind: "work",
              startDayIso: "2026-05-12",
              startSlot: 0,
              endDayIso: "2026-05-12",
              endSlot: 4,
              label: "",
            },
          ],
        },
        {
          estimatedStart: "2026-05-13",
          estimatedEnd: "2026-05-14",
          startSlot: 2,
          endSlot: 6,
          process: "B",
          timelineBlocks: [
            {
              kind: "work",
              startDayIso: "2026-05-13",
              startSlot: 2,
              endDayIso: "2026-05-13",
              endSlot: 6,
              label: "",
            },
          ],
        },
      ],
      new Map(),
      new Set(),
      "Lámpara 1",
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe("work");
    expect(blocks[0]!.startDayIso).toBe("2026-05-12");
    expect(blocks[0]!.startSlot).toBe(0);
    expect(blocks[0]!.endDayIso).toBe("2026-05-13");
    expect(blocks[0]!.endSlot).toBe(6);
  });

  it("maps slots to proportional axis fractions without minimum width", () => {
    const axis = ["2026-05-12", "2026-05-13"];
    expect(toAxisFraction(axis, "2026-05-12", 0)).toBe(0);
    expect(toAxisFraction(axis, "2026-05-12", 2)).toBe(0.25);

    const range = resolveBlockRange(axis, {
      startDayIso: "2026-05-12",
      startSlot: 0,
      endDayIso: "2026-05-12",
      endSlot: 2,
    });
    expect(range).toEqual({ startFrac: 0, endFrac: 0.25 });
  });
});
