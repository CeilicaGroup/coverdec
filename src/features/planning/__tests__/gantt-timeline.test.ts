import { describe, expect, it } from "vitest";
import { buildGanttTimeAxisContext } from "@/features/planning/gantt-time-axis";
import {
  addWallClockWait,
  buildContinuousTimeline,
  buildTaskTimelineBlocks,
  resolveBlockRange,
  slotToEndMinutes,
  slotToStartMinutes,
  toAxisFraction,
} from "@/features/planning/gantt-timeline";

const person = {
  id: "p1",
  iniciales: "AB",
  nombre: "Ana",
  color: "#000",
};

const timeAxis = buildGanttTimeAxisContext([
  { dayOfWeek: 1, startMinutes: 7 * 60, endMinutes: 18 * 60 },
  { dayOfWeek: 2, startMinutes: 7 * 60, endMinutes: 18 * 60 },
  { dayOfWeek: 3, startMinutes: 7 * 60, endMinutes: 18 * 60 },
  { dayOfWeek: 4, startMinutes: 7 * 60, endMinutes: 18 * 60 },
  { dayOfWeek: 5, startMinutes: 7 * 60, endMinutes: 18 * 60 },
]);

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
      process: "PINT",
      isCompleted: false,
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
    expect(wait!.startMinutes).toBe(slotToEndMinutes(2));
    expect(
      wait!.endDayIso > wait!.startDayIso ||
        wait!.endMinutes > wait!.startMinutes,
    ).toBe(true);
  });

  it("maps minutes to axis fraction using worker schedule bounds", () => {
    const axis = ["2026-05-12", "2026-05-13"];
    const bounds = timeAxis.boundsForDayIso("2026-05-12");
    const startMinutes = bounds.dayStartMinutes;
    expect(toAxisFraction(axis, "2026-05-12", startMinutes, timeAxis)).toBe(0);

    const twoHoursIn = startMinutes + 120;
    const frac = toAxisFraction(axis, "2026-05-12", twoHoursIn, timeAxis);
    expect(frac).toBeCloseTo(120 / (bounds.dayEndMinutes - bounds.dayStartMinutes), 5);
  });

  it("caps wait block before next process start to avoid overlap", () => {
    const blocks = buildTaskTimelineBlocks(
      [assignment(0, 2, 2, "2026-05-12T00:00:00.000Z")],
      "t1",
      24,
      new Set(),
      "IMPRIMACION",
      {
        dayIso: "2026-05-12",
        slot: 4,
        minutes: slotToStartMinutes(4),
      },
    );
    const wait = blocks.find((b) => b.kind === "wait");
    expect(wait).toBeDefined();
    expect(wait!.endMinutes).toBe(slotToStartMinutes(4));
    const axis = ["2026-05-12"];
    const waitRange = resolveBlockRange(axis, wait!, timeAxis);
    const workRange = resolveBlockRange(axis, blocks[0]!, timeAxis);
    expect(waitRange).not.toBeNull();
    expect(workRange).not.toBeNull();
    expect(waitRange!.startFrac).toBeGreaterThanOrEqual(workRange!.endFrac - 0.01);
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
              startMinutes: slotToStartMinutes(0),
              endDayIso: "2026-05-12",
              endSlot: 4,
              endMinutes: slotToEndMinutes(4),
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
              startMinutes: slotToStartMinutes(2),
              endDayIso: "2026-05-13",
              endSlot: 6,
              endMinutes: slotToEndMinutes(6),
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
    expect(blocks[0]!.startMinutes).toBe(slotToStartMinutes(0));
    expect(blocks[0]!.endMinutes).toBe(slotToEndMinutes(6));
  });

  it("adds wall-clock wait from assignment end", () => {
    const end = addWallClockWait("2026-05-12", 2, 2);
    expect(end.minutes).toBe(slotToEndMinutes(2) + 120);
  });
});
