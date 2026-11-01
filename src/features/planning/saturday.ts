import { prisma } from "@/lib/db";
import { getMondayOf } from "@/lib/week";
import type { HorizonDays } from "./plan-from";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sábados laborables: se deciden por entrega (a veces todo el equipo, a veces
 * unos pocos). Se guardan como PersonScheduleOverride de cada persona en ese
 * sábado; la plantilla semanal sigue siendo lun–vie. Una semana con sábado
 * habilitado se planifica con 6 días; sin él, exactamente igual que siempre.
 */
export function saturdayOf(weekStart: Date): Date {
  return new Date(getMondayOf(weekStart).getTime() + 5 * DAY_MS);
}

export function isSaturdayIso(dateIso: string): boolean {
  return new Date(`${dateIso}T00:00:00.000Z`).getUTCDay() === 6;
}

export interface SaturdayWork {
  dateIso: string;
  personIds: string[];
  startMinutes: number;
  endMinutes: number;
}

/** Quién trabaja el sábado de esa semana (personas activas con franja ese día). */
export async function loadSaturdayWork(
  weekStart: Date,
  naveIds?: string[],
): Promise<SaturdayWork | null> {
  const date = saturdayOf(weekStart);
  const overrides = await prisma.personScheduleOverride.findMany({
    where: {
      date,
      windows: { some: {} },
      person: {
        isActive: true,
        ...(naveIds ? { personNaves: { some: { naveId: { in: naveIds } } } } : {}),
      },
    },
    select: { personId: true, windows: { select: { startMinutes: true, endMinutes: true } } },
  });
  if (overrides.length === 0) return null;
  const windows = overrides.flatMap((o) => o.windows);
  return {
    dateIso: date.toISOString().slice(0, 10),
    personIds: overrides.map((o) => o.personId),
    startMinutes: Math.min(...windows.map((w) => w.startMinutes)),
    endMinutes: Math.max(...windows.map((w) => w.endMinutes)),
  };
}

export async function planningHorizonDays(
  weekStart: Date,
  naveIds?: string[],
): Promise<HorizonDays> {
  return (await loadSaturdayWork(weekStart, naveIds)) ? 6 : 5;
}

/** ¿Hay que enseñar el sábado en las vistas de esa semana? (habilitado o con tareas ese día) */
export async function weekHasSaturday(weekStart: Date): Promise<boolean> {
  const date = saturdayOf(weekStart);
  const [override, assignment] = await Promise.all([
    prisma.personScheduleOverride.findFirst({
      where: { date, windows: { some: {} } },
      select: { id: true },
    }),
    prisma.planningAssignment.findFirst({ where: { date }, select: { id: true } }),
  ]);
  return override != null || assignment != null;
}
