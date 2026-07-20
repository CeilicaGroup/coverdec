import { describe, expect, it } from "vitest";
import {
  buildWorkOrderAttentionMetrics,
  compareWorkOrdersByAttention,
} from "../attention-priority";

describe("buildWorkOrderAttentionMetrics", () => {
  const thresholds = { maxPendingHours: 16, maxTasks: 8 };

  it("marks open work orders with exceeded hours", () => {
    expect(
      buildWorkOrderAttentionMetrics(
        { status: "OPEN", pendingHours: 20, taskCount: 4 },
        thresholds,
      ),
    ).toEqual({
      status: "excess_hours",
      severity: 2,
      needsAttention: true,
    });
  });

  it("marks open work orders with exceeded tasks", () => {
    expect(
      buildWorkOrderAttentionMetrics(
        { status: "OPEN", pendingHours: 10, taskCount: 10 },
        thresholds,
      ),
    ).toEqual({
      status: "excess_tasks",
      severity: 1,
      needsAttention: true,
    });
  });

  it("keeps closed work orders as normal", () => {
    expect(
      buildWorkOrderAttentionMetrics(
        { status: "CLOSED", pendingHours: 99, taskCount: 99 },
        thresholds,
      ),
    ).toEqual({
      status: "normal",
      severity: 0,
      needsAttention: false,
    });
  });
});

describe("compareWorkOrdersByAttention", () => {
  it("prioritizes open work orders requiring attention", () => {
    const thresholds = { maxPendingHours: 16, maxTasks: 8 };
    const rows = [
      {
        id: "closed",
        status: "CLOSED" as const,
        pendingHours: 30,
        taskCount: 12,
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "normal-open",
        status: "OPEN" as const,
        pendingHours: 8,
        taskCount: 3,
        createdAt: new Date("2026-02-01"),
      },
      {
        id: "excess-open",
        status: "OPEN" as const,
        pendingHours: 24,
        taskCount: 10,
        createdAt: new Date("2026-03-01"),
      },
    ].map((row) => ({
      ...row,
      attention: buildWorkOrderAttentionMetrics(row, thresholds),
    }));

    rows.sort(compareWorkOrdersByAttention);
    expect(rows.map((row) => row.id)).toEqual([
      "excess-open",
      "normal-open",
      "closed",
    ]);
  });
});
