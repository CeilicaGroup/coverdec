import { AttendanceSource } from "@/generated/prisma";
import { describe, expect, it } from "vitest";
import {
  formatAttendanceSource,
  operarioCanDeleteSession,
  operarioCanEditSession,
  operarioCanManageBreaks,
  ownsAttendanceSession,
} from "../source-display";

const userId = "user-1";

describe("source-display", () => {
  it("labels attendance sources", () => {
    expect(formatAttendanceSource(AttendanceSource.BUTTON)).toBe("Fichaje en vivo");
    expect(formatAttendanceSource(AttendanceSource.MANUAL)).toBe("Registro manual");
    expect(formatAttendanceSource(AttendanceSource.ADMIN_EDIT)).toBe("Añadido por jefe");
  });

  it("checks ownership", () => {
    expect(ownsAttendanceSession({ userId }, userId)).toBe(true);
    expect(ownsAttendanceSession({ userId: "other" }, userId)).toBe(false);
  });

  it("allows operario to edit any own closed session", () => {
    expect(
      operarioCanEditSession(
        { userId, endedAt: "2026-06-15T14:00:00.000Z" },
        userId,
      ),
    ).toBe(true);
    expect(
      operarioCanEditSession(
        { userId, endedAt: "2026-06-15T14:00:00.000Z" },
        "other",
      ),
    ).toBe(false);
    expect(operarioCanEditSession({ userId, endedAt: null }, userId)).toBe(false);
  });

  it("allows operario to delete any own session", () => {
    expect(operarioCanDeleteSession({ userId }, userId)).toBe(true);
    expect(operarioCanDeleteSession({ userId }, "other")).toBe(false);
  });

  it("allows operario to manage breaks on own closed sessions", () => {
    expect(
      operarioCanManageBreaks({ userId, endedAt: "2026-06-15T14:00:00.000Z" }, userId),
    ).toBe(true);
    expect(operarioCanManageBreaks({ userId, endedAt: null }, userId)).toBe(false);
  });
});
