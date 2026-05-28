import { describe, expect, it } from "vitest";
import { mergeBastidorRowEdits } from "../validate";
import type { BastidorRowDraft } from "../types";

describe("merge row edits", () => {
  it("clears unknown process after edit", () => {
    const rows: BastidorRowDraft[] = [
      {
        rowIndex: 2,
        frameName: "YPLUS",
        processName: "FOO",
        hoursPerUnit: 1,
        frameCode: null,
        processCode: null,
        issues: [
          {
            code: "UNKNOWN_PROCESS",
            field: "processName",
            message: "x",
            severity: "error",
          },
        ],
        status: "error",
        action: "skip",
      },
    ];
    const merged = mergeBastidorRowEdits(rows, [
      { rowIndex: 2, patch: { processName: "CNC" } },
    ]);
    expect(merged[0].processCode).toBe("CNC");
    expect(merged[0].issues.some((i) => i.code === "UNKNOWN_PROCESS")).toBe(
      false,
    );
  });
});
