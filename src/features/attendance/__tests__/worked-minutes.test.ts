import { describe, expect, it } from "vitest";
import {
  breakTotalMs,
  workedSessionMinutes,
  workedSessionMs,
  workedSessionSecondsWithLiveBreak,
} from "../worked-minutes";

describe("worked-minutes", () => {
  const sessionStart = new Date("2026-06-15T08:00:00.000Z");
  const sessionEnd = new Date("2026-06-15T14:00:00.000Z");

  it("returns gross duration when there are no breaks", () => {
    const at = new Date("2026-06-15T12:00:00.000Z");
    expect(
      workedSessionMinutes(
        { startedAt: sessionStart, endedAt: sessionEnd, breaks: [] },
        at,
      ),
    ).toBe(360);
  });

  it("subtracts multiple closed breaks from a closed session", () => {
    const at = sessionEnd;
    expect(
      workedSessionMinutes(
        {
          startedAt: sessionStart,
          endedAt: sessionEnd,
          breaks: [
            {
              startedAt: new Date("2026-06-15T10:15:00.000Z"),
              endedAt: new Date("2026-06-15T10:30:00.000Z"),
              minutes: 15,
            },
            {
              startedAt: new Date("2026-06-15T12:00:00.000Z"),
              endedAt: new Date("2026-06-15T12:15:00.000Z"),
              minutes: 15,
            },
          ],
        },
        at,
      ),
    ).toBe(330);
  });

  it("freezes worked time while an open break is active", () => {
    const breakStart = new Date("2026-06-15T10:00:00.000Z");
    const at = new Date("2026-06-15T10:30:00.000Z");
    const session = {
      startedAt: sessionStart,
      endedAt: null,
      breaks: [{ startedAt: breakStart, endedAt: null, minutes: null }],
    };
    expect(
      workedSessionSecondsWithLiveBreak(session, at, {
        activeBreakStartedAt: breakStart,
      }),
    ).toBe(2 * 60 * 60);
  });

  it("resumes counting after break ends even if session data still shows an open break", () => {
    const breakStart = new Date("2026-06-15T10:00:00.000Z");
    const breakEnd = new Date("2026-06-15T10:15:00.000Z");
    const at = new Date("2026-06-15T10:30:00.000Z");
    const session = {
      startedAt: sessionStart,
      endedAt: null,
      breaks: [{ startedAt: breakStart, endedAt: null, minutes: null }],
    };
    expect(
      workedSessionSecondsWithLiveBreak(session, at, {
        frozenBreaks: [{ startedAt: breakStart, endedAt: breakEnd }],
      }),
    ).toBe(2 * 60 * 60 + 15 * 60);
  });

  it("uses exact timestamps for closed breaks, not rounded minutes field", () => {
    const at = sessionEnd;
    expect(
      workedSessionMinutes(
        {
          startedAt: sessionStart,
          endedAt: sessionEnd,
          breaks: [
            {
              startedAt: new Date("2026-06-15T10:00:00.000Z"),
              endedAt: new Date("2026-06-15T10:00:05.000Z"),
              minutes: 1,
            },
          ],
        },
        at,
      ),
    ).toBe(360);
  });

  it("does not go below zero when breaks exceed gross time", () => {
    const at = sessionEnd;
    expect(
      workedSessionMinutes(
        {
          startedAt: sessionStart,
          endedAt: sessionEnd,
          breaks: [
            {
              startedAt: new Date("2026-06-15T08:00:00.000Z"),
              endedAt: new Date("2026-06-15T14:00:00.000Z"),
              minutes: 360,
            },
          ],
        },
        at,
      ),
    ).toBe(0);
    expect(breakTotalMs(
      {
        startedAt: sessionStart,
        endedAt: sessionEnd,
        breaks: [
          {
            startedAt: new Date("2026-06-15T08:00:00.000Z"),
            endedAt: new Date("2026-06-15T14:00:00.000Z"),
            minutes: 360,
          },
        ],
      },
      at,
    )).toBe(360 * 60_000);
  });
});
