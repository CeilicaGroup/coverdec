import { describe, expect, it } from "vitest";
import { buildWorkOrderAttentionMetrics } from "../attention-priority";
import type { TaskAssigneeSummary } from "../display-context";
import {
  compareWorkOrdersForSort,
  nextWorkOrderSortState,
  sortWorkOrders,
  type WorkOrderSortableRow,
} from "../sort-work-orders";

const thresholds = { maxPendingHours: 16, maxTasks: 8 };

function row(
  partial: Partial<WorkOrderSortableRow> &
    Pick<WorkOrderSortableRow, "number" | "status" | "pendingHours" | "taskCount">,
): WorkOrderSortableRow {
  const base = {
    createdAt: new Date("2026-01-01"),
    closedAt: null as Date | null,
    tasks: [] as WorkOrderSortableRow["tasks"],
    taskIds: [] as string[],
    ...partial,
  };
  return {
    ...base,
    attention: buildWorkOrderAttentionMetrics(base, thresholds),
  };
}

describe("sortWorkOrders", () => {
  it("keeps attention priority when no column is selected", () => {
    const rows = [
      row({
        number: "OT-1",
        status: "CLOSED",
        pendingHours: 30,
        taskCount: 12,
      }),
      row({
        number: "OT-2",
        status: "OPEN",
        pendingHours: 8,
        taskCount: 3,
      }),
      row({
        number: "OT-3",
        status: "OPEN",
        pendingHours: 24,
        taskCount: 10,
      }),
    ];

    const sorted = sortWorkOrders(
      rows,
      { column: null, direction: "asc" },
      new Map(),
    );
    expect(sorted.map((r) => r.number)).toEqual(["OT-3", "OT-2", "OT-1"]);
  });

  it("sorts pending hours ascending and descending", () => {
    const rows = [
      row({ number: "A", status: "OPEN", pendingHours: 10, taskCount: 1 }),
      row({ number: "B", status: "OPEN", pendingHours: 2, taskCount: 1 }),
      row({ number: "C", status: "OPEN", pendingHours: 5, taskCount: 1 }),
    ];

    expect(
      sortWorkOrders(
        rows,
        { column: "pendingHours", direction: "asc" },
        new Map(),
      ).map((r) => r.number),
    ).toEqual(["B", "C", "A"]);

    expect(
      sortWorkOrders(
        rows,
        { column: "pendingHours", direction: "desc" },
        new Map(),
      ).map((r) => r.number),
    ).toEqual(["A", "C", "B"]);
  });

  it("keeps closedAt nulls at the end in both directions", () => {
    const rows = [
      row({
        number: "open",
        status: "OPEN",
        pendingHours: 1,
        taskCount: 1,
        closedAt: null,
      }),
      row({
        number: "old",
        status: "CLOSED",
        pendingHours: 0,
        taskCount: 1,
        closedAt: new Date("2026-01-01"),
      }),
      row({
        number: "new",
        status: "CLOSED",
        pendingHours: 0,
        taskCount: 1,
        closedAt: new Date("2026-06-01"),
      }),
    ];

    expect(
      sortWorkOrders(
        rows,
        { column: "closedAt", direction: "asc" },
        new Map(),
      ).map((r) => r.number),
    ).toEqual(["old", "new", "open"]);

    expect(
      sortWorkOrders(
        rows,
        { column: "closedAt", direction: "desc" },
        new Map(),
      ).map((r) => r.number),
    ).toEqual(["new", "old", "open"]);
  });

  it("sorts assignee by label", () => {
    const assigneeByTaskId = new Map<string, TaskAssigneeSummary>([
      ["t1", { personId: "p1", label: "Ana", iniciales: "A" }],
      ["t2", { personId: "p2", label: "Bruno", iniciales: "B" }],
    ]);
    const rows = [
      row({
        number: "OT-B",
        status: "OPEN",
        pendingHours: 1,
        taskCount: 1,
        taskIds: ["t2"],
      }),
      row({
        number: "OT-A",
        status: "OPEN",
        pendingHours: 1,
        taskCount: 1,
        taskIds: ["t1"],
      }),
    ];

    expect(
      sortWorkOrders(
        rows,
        { column: "assignee", direction: "asc" },
        assigneeByTaskId,
      ).map((r) => r.number),
    ).toEqual(["OT-A", "OT-B"]);
  });
});

describe("nextWorkOrderSortState", () => {
  it("starts ascending on a new column and toggles direction", () => {
    expect(nextWorkOrderSortState({ column: null, direction: "asc" }, "number")).toEqual({
      column: "number",
      direction: "asc",
    });
    expect(
      nextWorkOrderSortState({ column: "number", direction: "asc" }, "number"),
    ).toEqual({ column: "number", direction: "desc" });
  });
});

describe("compareWorkOrdersForSort", () => {
  it("falls back to OT number when values tie", () => {
    const a = row({ number: "OT-2", status: "OPEN", pendingHours: 5, taskCount: 1 });
    const b = row({ number: "OT-1", status: "OPEN", pendingHours: 5, taskCount: 1 });
    expect(
      compareWorkOrdersForSort(
        a,
        b,
        { column: "pendingHours", direction: "asc" },
        new Map(),
      ),
    ).toBeGreaterThan(0);
  });
});
