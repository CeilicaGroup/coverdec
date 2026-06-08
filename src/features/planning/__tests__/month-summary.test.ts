import { describe, expect, it } from "vitest";
import {
  summarizeMonthFromDaySummaries,
  summarizePlanningByDay,
  summarizeWeekRowsFromCalendar,
  type DayPlanningSummary,
} from "@/features/planning/queries";
import { PlanningStatus } from "@/generated/prisma";

describe("month planning summaries", () => {
  it("summarizePlanningByDay includes projects, processes and assignment count", () => {
    const day = new Date("2026-05-04T12:00:00.000Z");
    const summaries = summarizePlanningByDay([
      {
        id: "a1",
        date: day,
        hours: 4,
        personId: "p1",
        process: "CNC",
        person: { id: "p1", iniciales: "AA", color: "#000" },
        task: { id: "t1", projectId: "pr1", project: { name: "Proyecto Alpha" } },
      },
      {
        id: "a2",
        date: day,
        hours: 2,
        personId: "p2",
        process: "LIJADO",
        person: { id: "p2", iniciales: "BB", color: "#111" },
        task: { id: "t2", projectId: "pr2", project: { name: "Proyecto Beta" } },
      },
    ]);

    const summary = summaries.get("2026-05-04");
    expect(summary?.totalHours).toBe(6);
    expect(summary?.assignmentCount).toBe(2);
    expect(summary?.people).toHaveLength(2);
    expect(summary?.projectCount).toBe(2);
    expect(summary?.processes).toEqual(["CNC", "LIJADO"]);
    expect(summary?.peopleHours).toHaveLength(2);
    expect(summary?.projects).toHaveLength(2);
    expect(summary?.projects[0]?.tasks).toHaveLength(1);
    expect(summary?.processHours).toHaveLength(2);
    expect(summary?.topProjects[0]?.name).toBe("Proyecto Alpha");
  });

  it("summarizeMonthFromDaySummaries aggregates month KPIs", () => {
    const summaries = new Map<string, DayPlanningSummary>([
      [
        "2026-05-04",
        {
          totalHours: 6,
          assignmentCount: 2,
          people: [{ id: "p1", iniciales: "AA", color: "#000" }],
          peopleHours: [{ id: "p1", iniciales: "AA", color: "#000", hours: 6 }],
          projectCount: 1,
          topProjects: [{ id: "pr1", name: "Alpha", hours: 6 }],
          projects: [
            {
              id: "pr1",
              name: "Alpha",
              hours: 6,
              tasks: [
                {
                  taskId: "t1",
                  process: "CNC",
                  personIniciales: "AA",
                  hours: 6,
                },
              ],
            },
          ],
          processes: ["CNC"],
          processHours: [{ process: "CNC", hours: 6 }],
        },
      ],
    ]);

    const stats = summarizeMonthFromDaySummaries({
      summariesByDay: summaries,
      businessDays: 20,
      calendarWeeks: 5,
      weeksWithPlanning: 2,
      projectCount: 3,
    });

    expect(stats.totalHours).toBe(6);
    expect(stats.plannedDays).toBe(1);
    expect(stats.peopleCount).toBe(1);
    expect(stats.projectCount).toBe(3);
    expect(stats.weeksWithPlanning).toBe(2);
  });

  it("summarizeWeekRowsFromCalendar groups hours by ISO week row", () => {
    const weeks = [
      [
        { iso: "2026-05-04" },
        { iso: "2026-05-05" },
        { iso: "2026-05-06" },
        { iso: "2026-05-07" },
        { iso: "2026-05-08" },
      ],
    ];
    const summaries = new Map<string, DayPlanningSummary>([
      [
        "2026-05-04",
        {
          totalHours: 4,
          assignmentCount: 1,
          people: [],
          peopleHours: [],
          projectCount: 1,
          topProjects: [],
          projects: [],
          processes: [],
          processHours: [],
        },
      ],
      [
        "2026-05-05",
        {
          totalHours: 2,
          assignmentCount: 1,
          people: [],
          peopleHours: [],
          projectCount: 1,
          topProjects: [],
          projects: [],
          processes: [],
          processHours: [],
        },
      ],
    ]);

    const rows = summarizeWeekRowsFromCalendar(weeks, summaries, [
      {
        weekStart: new Date("2026-05-04T00:00:00.000Z"),
        status: PlanningStatus.DRAFT,
      },
    ]);

    const row = rows.get("2026-05-04");
    expect(row?.totalHours).toBe(6);
    expect(row?.status).toBe(PlanningStatus.DRAFT);
  });
});
