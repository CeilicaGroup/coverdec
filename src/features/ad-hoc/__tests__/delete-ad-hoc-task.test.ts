import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import {
  AD_HOC_DELETE_HAS_TIME_ENTRIES_ERROR,
  AD_HOC_DELETE_NOT_AD_HOC_ERROR,
  assertCanDeleteAdHocTask,
} from "@/features/ad-hoc/delete-ad-hoc-task";

describe("assertCanDeleteAdHocTask", () => {
  it("allows deleting ad-hoc tasks without time entries", () => {
    expect(() =>
      assertCanDeleteAdHocTask({
        systemKind: TaskSystemKind.AD_HOC,
        _count: { timeEntries: 0 },
      }),
    ).not.toThrow();
  });

  it("rejects production tasks", () => {
    expect(() =>
      assertCanDeleteAdHocTask({
        systemKind: null,
        _count: { timeEntries: 0 },
      }),
    ).toThrow(AD_HOC_DELETE_NOT_AD_HOC_ERROR);
  });

  it("rejects ad-hoc tasks with logged hours", () => {
    expect(() =>
      assertCanDeleteAdHocTask({
        systemKind: TaskSystemKind.AD_HOC,
        _count: { timeEntries: 2 },
      }),
    ).toThrow(AD_HOC_DELETE_HAS_TIME_ENTRIES_ERROR);
  });
});
