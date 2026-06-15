import { AttendanceSource } from "@/generated/prisma";
import { describe, expect, it } from "vitest";
import {
  formatAttendanceSource,
  operarioCanDeleteSession,
  operarioCanEditSession,
} from "../source-display";

describe("source-display", () => {
  it("labels attendance sources", () => {
    expect(formatAttendanceSource(AttendanceSource.BUTTON)).toBe("Fichaje en vivo");
    expect(formatAttendanceSource(AttendanceSource.MANUAL)).toBe("Registro manual");
    expect(formatAttendanceSource(AttendanceSource.ADMIN_EDIT)).toBe("Añadido por jefe");
  });

  it("allows operario to edit own closed manual and button sessions", () => {
    expect(
      operarioCanEditSession({
        id: "s1",
        source: AttendanceSource.MANUAL,
        endedAt: "2026-06-15T14:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      operarioCanEditSession({
        id: "s1",
        source: AttendanceSource.BUTTON,
        endedAt: "2026-06-15T14:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      operarioCanEditSession({
        id: "s1",
        source: AttendanceSource.ADMIN_EDIT,
        endedAt: "2026-06-15T14:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      operarioCanEditSession({
        id: "s1",
        source: AttendanceSource.MANUAL,
        endedAt: null,
      }),
    ).toBe(false);
  });

  it("allows operario to delete only manual closed sessions", () => {
    expect(
      operarioCanDeleteSession({
        source: AttendanceSource.MANUAL,
        endedAt: "2026-06-15T14:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      operarioCanDeleteSession({
        source: AttendanceSource.BUTTON,
        endedAt: "2026-06-15T14:00:00.000Z",
      }),
    ).toBe(false);
  });
});
