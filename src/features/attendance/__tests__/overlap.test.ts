import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("attendance overlap policy", () => {
  it("stopAttendance does not block closing on assertNoAttendanceOverlap", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/attendance/actions.ts"),
      "utf8",
    );
    const stopFn = source.slice(
      source.indexOf("export async function stopAttendance"),
      source.indexOf("export async function startBreak"),
    );
    expect(stopFn).not.toContain("assertNoAttendanceOverlap");
  });
});
