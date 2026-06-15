import { AttendanceSource } from "@/generated/prisma";

const SOURCE_LABELS: Record<AttendanceSource, string> = {
  [AttendanceSource.BUTTON]: "Fichaje en vivo",
  [AttendanceSource.MANUAL]: "Registro manual",
  [AttendanceSource.ADMIN_EDIT]: "Añadido por jefe",
};

export function formatAttendanceSource(source: string): string {
  if (source in SOURCE_LABELS) {
    return SOURCE_LABELS[source as AttendanceSource];
  }
  return source;
}

export function ownsAttendanceSession(session: { userId: string }, currentUserId: string): boolean {
  return session.userId === currentUserId;
}

export function operarioCanEditSession(
  session: { endedAt: string | null; userId: string },
  currentUserId: string,
): boolean {
  return ownsAttendanceSession(session, currentUserId) && session.endedAt != null;
}

export function operarioCanDeleteSession(
  session: { userId: string },
  currentUserId: string,
): boolean {
  return ownsAttendanceSession(session, currentUserId);
}

export function operarioCanManageBreaks(
  session: { endedAt: string | null; userId: string },
  currentUserId: string,
): boolean {
  return ownsAttendanceSession(session, currentUserId) && session.endedAt != null;
}
