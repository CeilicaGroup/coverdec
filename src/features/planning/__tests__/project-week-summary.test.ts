import { describe, expect, it } from "vitest";
import {
  summarizeAllActiveProjects,
  summarizeUnassignedProjects,
  type getActiveProjectsWithLoad,
} from "@/features/planning/queries";

type ProjectWithLoad = Awaited<ReturnType<typeof getActiveProjectsWithLoad>>[number];

const projects = [
  {
    id: "p1",
    code: "TEST",
    name: "Test",
    deliveryDate: null,
    planningPreset: "EQUILIBRADO" as const,
    planningCostPriority: 50,
    planningStability: 50,
    planningDeadlineBoost: 50,
    tasks: [
      {
        id: "t1",
        process: "CNC",
        estimatedHours: 10,
        doneHours: 0,
        pendingHours: 10,
        isCompleted: false,
      },
      {
        id: "t2",
        process: "ENSAMBLAJE",
        estimatedHours: 15,
        doneHours: 0,
        pendingHours: 15,
        isCompleted: false,
      },
    ],
  },
] as ProjectWithLoad[];

describe("project week summary with prior draft planning", () => {
  it("shows 100% base progress in week 2 when week 1 draft covered all hours", () => {
    const priorByTask = new Map([
      ["t1", 10],
      ["t2", 15],
    ]);
    const priorByProject = new Map([["p1", 25]]);
    const priorEnd = new Map([
      ["p1", new Date("2026-06-04T00:00:00.000Z")],
    ]);

    const rows = summarizeAllActiveProjects(projects, null, priorByProject, {
      priorPlannedHoursByTask: priorByTask,
      priorPlannedEndByProject: priorEnd,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.progressPct).toBe(100);
    expect(rows[0]!.expectedProgressPct).toBe(100);
    expect(rows[0]!.pendingHours).toBe(0);
    expect(rows[0]!.expectedCompletion?.toISOString().slice(0, 10)).toBe(
      "2026-06-04",
    );
  });

  it("excludes fully planned projects from unassigned tab in following week", () => {
    const priorByTask = new Map([
      ["t1", 10],
      ["t2", 15],
    ]);
    const priorByProject = new Map([["p1", 25]]);

    const unassigned = summarizeUnassignedProjects(
      projects,
      null,
      priorByProject,
      { priorPlannedHoursByTask: priorByTask },
    );

    expect(unassigned).toHaveLength(0);
  });

  it("starts week 2 from prior completion and adds this week assignments", () => {
    const priorByTask = new Map([["t1", 10]]);
    const priorByProject = new Map([["p1", 10]]);

    const planning = {
      assignments: [
        {
          taskId: "t2",
          hours: 5,
          date: new Date("2026-06-09T00:00:00.000Z"),
          task: { projectId: "p1" },
        },
      ],
    } as never;

    const rows = summarizeAllActiveProjects(projects, planning, priorByProject, {
      priorPlannedHoursByTask: priorByTask,
    });

    expect(rows[0]!.progressPct).toBe(40);
    expect(rows[0]!.expectedProgressPct).toBe(60);
    expect(rows[0]!.assignedThisWeek).toBe(5);
    expect(rows[0]!.pendingHours).toBe(10);
  });
});
