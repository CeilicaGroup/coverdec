import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { TRANSPORT_PROCESS_CODE } from "@/features/projects/transport-tasks";
import {
  excludeWorkOrderExemptTasksWhere,
  isWorkOrderExemptTask,
} from "../task-ot-exemptions";

describe("isWorkOrderExemptTask", () => {
  it("treats null systemKind production tasks as schedulable for OT", () => {
    expect(isWorkOrderExemptTask({ process: "CNC", systemKind: null })).toBe(
      false,
    );
  });
});

describe("excludeWorkOrderExemptTasksWhere", () => {
  it("includes null systemKind explicitly for SQL-safe OT queries", () => {
    expect(excludeWorkOrderExemptTasksWhere()).toEqual({
      process: { notIn: [IMPREVISTA_PROCESS_CODE, TRANSPORT_PROCESS_CODE] },
      OR: [
        { systemKind: null },
        {
          systemKind: {
            notIn: [TaskSystemKind.AD_HOC, TaskSystemKind.TRANSPORT],
          },
        },
      ],
    });
  });
});
