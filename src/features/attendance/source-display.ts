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

export function operarioCanEditSession(session: {
  source: string;
  endedAt: string | null;
  id: string;
}): boolean {
  if (session.endedAt == null) return false;
  return session.source === AttendanceSource.MANUAL || session.source === AttendanceSource.BUTTON;
}

export function operarioCanDeleteSession(session: {
  source: string;
  endedAt: string | null;
}): boolean {
  return session.endedAt != null && session.source === AttendanceSource.MANUAL;
}
