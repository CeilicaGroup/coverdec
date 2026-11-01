import { describe, expect, it } from "vitest";
import {
  scheduleAdHocTasksDetailed,
  schedulePendingAdHocTasks,
  type PendingAdHocTaskForScheduling,
} from "@/features/ad-hoc/schedule-ad-hoc-tasks";

describe("schedulePendingAdHocTasks", () => {
  const weekStart = new Date("2026-07-13T00:00:00.000Z");

  it("assigns the same slot to all participants", () => {
    const pending: PendingAdHocTaskForScheduling[] = [
      {
        id: "task-1",
        process: "IMPREVISTA",
        estimatedHours: 2,
        participantIds: ["person-1", "person-2"],
      },
    ];

    const scheduled = schedulePendingAdHocTasks(pending, {
      naveId: "nave-1",
      weekStart,
      firstSchedulableDayIndex: 0,
      occupied: [
        {
          taskId: "other",
          personId: "person-1",
          date: new Date("2026-07-13T00:00:00.000Z"),
          startSlot: 0,
          endSlot: 2,
        },
      ],
      alreadyPlannedTaskIds: new Set(),
    });

    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]?.startSlot).toBe(2);
    expect(scheduled[1]?.startSlot).toBe(2);
    expect(scheduled[0]?.endSlot).toBe(4);
    expect(scheduled[1]?.endSlot).toBe(4);
    expect(scheduled[0]?.personId).toBe("person-1");
    expect(scheduled[1]?.personId).toBe("person-2");
    expect(scheduled[0]?.date.toISOString()).toBe(scheduled[1]?.date.toISOString());
  });

  it("skips tasks that are already planned", () => {
    const pending: PendingAdHocTaskForScheduling[] = [
      {
        id: "task-1",
        process: "IMPREVISTA",
        estimatedHours: 1,
        participantIds: ["person-1"],
      },
    ];

    const scheduled = schedulePendingAdHocTasks(pending, {
      naveId: "nave-1",
      weekStart,
      firstSchedulableDayIndex: 0,
      occupied: [],
      alreadyPlannedTaskIds: new Set(["task-1"]),
    });

    expect(scheduled).toEqual([]);
  });

  it("uses Saturday only for people who work it", () => {
    const pending: PendingAdHocTaskForScheduling[] = [
      { id: "task-1", process: "IMPREVISTA", estimatedHours: 2, participantIds: ["person-1"] },
    ];
    const friday = new Date("2026-07-17T00:00:00.000Z");
    const args = {
      naveId: "nave-1",
      weekStart,
      firstSchedulableDayIndex: 4,
      occupied: [{ taskId: "other", personId: "person-1", date: friday, startSlot: 0, endSlot: 8 }],
      alreadyPlannedTaskIds: new Set<string>(),
    };

    // Sin sábado laborable, lo que no cabe el viernes queda para la semana siguiente.
    expect(scheduleAdHocTasksDetailed(pending, args).unplaced).toEqual([{ taskId: "task-1", hours: 2 }]);

    const saturdayMorning = (_: string, date: Date) =>
      date.getUTCDay() === 6 ? [{ start: 0, end: 6 }] : [{ start: 0, end: 8 }];
    const { slices, unplaced } = scheduleAdHocTasksDetailed(pending, {
      ...args,
      availability: saturdayMorning,
    });
    expect(unplaced).toEqual([]);
    expect(slices.map((s) => s.date.toISOString().slice(0, 10))).toEqual(["2026-07-18"]);
  });
});
