import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import {
  assertPersonSharesNave,
  assertTaskSubstitutable,
  TASK_SUBSTITUTE_AD_HOC_ERROR,
  TASK_SUBSTITUTE_NAVE_MISMATCH_ERROR,
  TASK_SUBSTITUTE_NOT_PLANNED_ERROR,
} from "@/features/projects/task-substitute";

describe("assertTaskSubstitutable", () => {
  it("allows a planned productive task", () => {
    expect(() =>
      assertTaskSubstitutable({ systemKind: null, _count: { assignments: 1 } }),
    ).not.toThrow();
  });

  it("rejects an unplanned task", () => {
    expect(() =>
      assertTaskSubstitutable({ systemKind: null, _count: { assignments: 0 } }),
    ).toThrow(TASK_SUBSTITUTE_NOT_PLANNED_ERROR);
  });

  it("rejects an ad-hoc task", () => {
    expect(() =>
      assertTaskSubstitutable({
        systemKind: TaskSystemKind.AD_HOC,
        _count: { assignments: 1 },
      }),
    ).toThrow(TASK_SUBSTITUTE_AD_HOC_ERROR);
  });
});

describe("assertPersonSharesNave", () => {
  it("allows a person assigned to the task nave", () => {
    expect(() => assertPersonSharesNave(["nave-1"], "nave-1")).not.toThrow();
  });

  it("rejects a person from a different nave", () => {
    expect(() => assertPersonSharesNave(["nave-2"], "nave-1")).toThrow(
      TASK_SUBSTITUTE_NAVE_MISMATCH_ERROR,
    );
  });
});
