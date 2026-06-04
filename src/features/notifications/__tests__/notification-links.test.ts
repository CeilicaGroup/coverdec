import { describe, expect, it } from "vitest";
import { NotificationType } from "@/generated/prisma";
import { resolveNotificationAction } from "../notification-links";

describe("resolveNotificationAction", () => {
  it("links catalog deviation to desviaciones with query params", () => {
    const action = resolveNotificationAction(
      NotificationType.TASK_TIME_DEVIATION_FROM_CATALOG,
      {
        eventKey: "task-time-deviation:ft1:CNC",
        frameTypeId: "ft1",
        process: "CNC",
        frameTypeCode: "HAIR",
        frameTypeName: "Hair",
        catalogHoursPerUnit: 1,
        observedHoursPerUnit: 2,
        deviationPct: 50,
        sampleCount: 10,
      },
      {},
    );
    expect(action?.href).toBe("/dashboard/desviaciones-tiempos?frameTypeId=ft1&process=CNC");
    expect(action?.label).toContain("HAIR");
  });

  it("links planning alerts to semana with week", () => {
    const action = resolveNotificationAction(
      NotificationType.PLAN_PUBLISHED_LOW_OCCUPATION,
      { eventKey: "x", planningId: "p1", naveId: "n1", occupationPct: 80, assignedHours: 1, capacityHours: 2 },
      { planningWeekIso: "2026-06-01" },
    );
    expect(action?.href).toBe("/dashboard/semana?week=2026-06-01");
  });
});
