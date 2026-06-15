export interface AttendanceBreakLike {
  startedAt: Date;
  endedAt: Date | null;
  minutes: number | null;
}

export interface AttendanceSessionLike {
  startedAt: Date;
  endedAt: Date | null;
  breaks: AttendanceBreakLike[];
}

export interface LiveBreakState {
  /** Only this break subtracts growing time; other open rows in data are ignored. */
  activeBreakStartedAt?: Date | null;
  /** Breaks ended locally before server props catch up. */
  frozenBreaks?: { startedAt: Date; endedAt: Date }[];
}

function breakDurationMs(breakRow: AttendanceBreakLike, at: Date): number {
  if (breakRow.endedAt != null) {
    return Math.max(0, breakRow.endedAt.getTime() - breakRow.startedAt.getTime());
  }
  return Math.max(0, at.getTime() - breakRow.startedAt.getTime());
}

function breakDurationMsForLiveSession(
  breakRow: AttendanceBreakLike,
  at: Date,
  live: LiveBreakState,
): number {
  if (breakRow.endedAt != null) {
    return breakDurationMs(breakRow, at);
  }
  const frozen = live.frozenBreaks?.find(
    (row) => row.startedAt.getTime() === breakRow.startedAt.getTime(),
  );
  if (frozen) {
    return Math.max(0, frozen.endedAt.getTime() - frozen.startedAt.getTime());
  }
  if (
    live.activeBreakStartedAt &&
    breakRow.startedAt.getTime() === live.activeBreakStartedAt.getTime()
  ) {
    return Math.max(0, at.getTime() - breakRow.startedAt.getTime());
  }
  return 0;
}

function extraLiveBreakMs(session: AttendanceSessionLike, at: Date, live: LiveBreakState): number {
  if (!live.activeBreakStartedAt) return 0;
  const inList = session.breaks.some(
    (row) => row.startedAt.getTime() === live.activeBreakStartedAt!.getTime(),
  );
  if (inList) return 0;
  return Math.max(0, at.getTime() - live.activeBreakStartedAt.getTime());
}

export function grossSessionMs(session: AttendanceSessionLike, at: Date): number {
  const end = session.endedAt ?? at;
  return Math.max(0, end.getTime() - session.startedAt.getTime());
}

export function breakTotalMs(session: AttendanceSessionLike, at: Date): number {
  return session.breaks.reduce((acc, row) => acc + breakDurationMs(row, at), 0);
}

export function workedSessionMs(session: AttendanceSessionLike, at: Date): number {
  return Math.max(0, grossSessionMs(session, at) - breakTotalMs(session, at));
}

export function workedSessionMsWithLiveBreak(
  session: AttendanceSessionLike,
  at: Date,
  live: LiveBreakState = {},
): number {
  const gross = grossSessionMs(session, at);
  const breakMs =
    session.breaks.reduce(
      (acc, row) => acc + breakDurationMsForLiveSession(row, at, live),
      0,
    ) + extraLiveBreakMs(session, at, live);
  return Math.max(0, gross - breakMs);
}

export function workedSessionMinutes(session: AttendanceSessionLike, at: Date): number {
  const ms = workedSessionMs(session, at);
  if (session.endedAt != null) {
    return Math.max(0, Math.round(ms / 60_000));
  }
  return Math.max(0, Math.floor(ms / 60_000));
}

export function workedSessionSeconds(session: AttendanceSessionLike, at: Date): number {
  return Math.max(0, Math.floor(workedSessionMs(session, at) / 1000));
}

export function workedSessionSecondsWithLiveBreak(
  session: AttendanceSessionLike,
  at: Date,
  live: LiveBreakState = {},
): number {
  return Math.max(0, Math.floor(workedSessionMsWithLiveBreak(session, at, live) / 1000));
}

export function breakMinutes(breakRow: AttendanceBreakLike, at: Date): number {
  return Math.max(0, Math.round(breakDurationMs(breakRow, at) / 60_000));
}
