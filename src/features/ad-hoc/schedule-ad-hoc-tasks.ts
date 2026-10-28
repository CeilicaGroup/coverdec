import { PlanningStatus, TaskSystemKind } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { utcDayStart } from "@/lib/holidays";
import { PRODUCTIVE_SLOTS_PER_DAY } from "@/features/planning/engine/slot-format";
import { AFTERNOON_START, MORNING_END, MORNING_START } from "@/features/planning/engine/types";
import {
  defaultWeeklyTemplate,
  getWindowsForDate,
  type PersonScheduleDayInput,
  type WorkWindowMinutes,
} from "@/features/planning/engine/slots/person-schedule";
import {
  absenceCoversCivilIso,
  absenceOverlapPrismaFilter,
  isFullDayAbsenceBlock,
  isRangeAbsence,
} from "@/features/people/absence-model";
import type { OverrideAssignmentSlice } from "@/features/planning/planning-override-preserve";
import { getMondayOf, isSameUtcDay, isoWeek } from "@/lib/week";

const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_STEP = 0.25;
const EPS = 1e-9;

export interface OccupiedAssignmentSlice {
  taskId: string;
  personId: string;
  date: Date;
  startSlot: number;
  endSlot: number;
}

export interface PendingAdHocTaskForScheduling {
  id: string;
  process: string;
  /** Horas que quedan por colocar (estimadas − fichadas − ya colocadas por delante en semanas previas). */
  estimatedHours: number;
  participantIds: string[];
}

/** Franjas de trabajo (en slots de planning) de una persona en un día. */
export type AdHocAvailability = (personId: string, date: Date) => SlotInterval[];

export interface ScheduleAdHocTasksArgs {
  naveId: string;
  weekStart: Date;
  firstSchedulableDayIndex: number;
  occupied: OccupiedAssignmentSlice[];
  alreadyPlannedTaskIds: Set<string>;
  onlyTaskIds?: Set<string>;
  /** Sin él se asume la jornada estándar (8–14 y 15–17) todos los días. */
  availability?: AdHocAvailability;
}

export interface UnplacedAdHocHours {
  taskId: string;
  hours: number;
}

export interface AdHocScheduleResult {
  slices: OverrideAssignmentSlice[];
  /** Horas que no caben esta semana: se avisan y se colocan al generar la siguiente. */
  unplaced: UnplacedAdHocHours[];
}

interface SlotInterval {
  start: number;
  end: number;
}

const STANDARD_DAY: SlotInterval[] = [{ start: 0, end: PRODUCTIVE_SLOTS_PER_DAY }];

function roundSlot(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundUpToQuarter(hours: number): number {
  return Math.ceil(hours * 4 - EPS) / 4;
}

/** Misma conversión minuto → slot que el solver (`_minute_to_ui_slot`): la comida no ocupa slots. */
function minuteToSlot(minute: number): number {
  if (minute < MORNING_END * 60) return (minute - MORNING_START * 60) / 60;
  if (minute >= AFTERNOON_START * 60) {
    return MORNING_END - MORNING_START + (minute - AFTERNOON_START * 60) / 60;
  }
  return MORNING_END - MORNING_START;
}

/** Ordena y fusiona franjas contiguas (8–14 y 15–17 quedan como un bloque 0–8, como en el solver). */
function normalize(intervals: SlotInterval[]): SlotInterval[] {
  const sorted = intervals
    .filter((i) => i.end - i.start > EPS)
    .sort((a, b) => a.start - b.start);
  const out: SlotInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + EPS) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function intersect(a: SlotInterval[], b: SlotInterval[]): SlotInterval[] {
  const out: SlotInterval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end - start > EPS) out.push({ start, end });
    }
  }
  return normalize(out);
}

function subtract(intervals: SlotInterval[], cut: SlotInterval): SlotInterval[] {
  return intervals.flatMap((i) => {
    if (cut.end <= i.start + EPS || cut.start >= i.end - EPS) return [i];
    const parts: SlotInterval[] = [];
    if (cut.start > i.start + EPS) parts.push({ start: i.start, end: cut.start });
    if (cut.end < i.end - EPS) parts.push({ start: cut.end, end: i.end });
    return parts;
  });
}

function windowsToSlots(windows: WorkWindowMinutes[]): SlotInterval[] {
  return normalize(
    windows.map((w) => ({ start: minuteToSlot(w.startMinutes), end: minuteToSlot(w.endMinutes) })),
  );
}

/** Huecos libres comunes a todos los participantes ese día, alineados a cuartos de hora. */
function commonFreeIntervals(args: {
  personIds: string[];
  date: Date;
  occupied: OccupiedAssignmentSlice[];
  availability: AdHocAvailability;
}): SlotInterval[] {
  let free: SlotInterval[] | null = null;
  for (const personId of args.personIds) {
    let own = normalize(args.availability(personId, args.date));
    for (const o of args.occupied) {
      if (o.personId !== personId || !isSameUtcDay(o.date, args.date)) continue;
      own = subtract(own, { start: o.startSlot, end: o.endSlot });
    }
    free = free === null ? own : intersect(free, own);
  }
  return (free ?? [])
    .map((i) => ({
      start: roundSlot(Math.ceil(i.start / SLOT_STEP - EPS) * SLOT_STEP),
      end: roundSlot(Math.floor(i.end / SLOT_STEP + EPS) * SLOT_STEP),
    }))
    .filter((i) => i.end - i.start >= SLOT_STEP - EPS);
}

function schedulableDates(weekStart: Date, firstSchedulableDayIndex: number): Date[] {
  return Array.from({ length: Math.max(0, 5 - firstSchedulableDayIndex) }, (_, index) =>
    utcDayStart(new Date(weekStart.getTime() + (firstSchedulableDayIndex + index) * DAY_MS)),
  );
}

export function firstSchedulableDayIndexFromToday(weekStart: Date): number {
  const today = utcDayStart(new Date());
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const day = utcDayStart(new Date(weekStart.getTime() + dayIndex * DAY_MS));
    if (day.getTime() >= today.getTime()) return dayIndex;
  }
  return 5;
}

/** Mismo criterio que la carga real: imprevistas con horas por colocar en esa semana. */
export async function countSchedulableAdHocTasksForNaves(
  naveIds: string[],
  weekStart: Date,
): Promise<number> {
  let count = 0;
  for (const naveId of new Set(naveIds)) {
    count += (await loadPendingAdHocTasksForScheduling(naveId, weekStart)).length;
  }
  return count;
}

export async function loadAdHocNaveIdByTaskId(
  taskIds: string[],
): Promise<Map<string, string>> {
  if (taskIds.length === 0) return new Map();

  const rows = await prisma.task.findMany({
    where: {
      id: { in: taskIds },
      systemKind: TaskSystemKind.AD_HOC,
    },
    select: { id: true, naveId: true },
  });

  return new Map(rows.map((row) => [row.id, row.naveId]));
}

/**
 * Imprevistas con horas por colocar en la semana `weekStart`:
 * - Si ya está colocada en una semana posterior, no se toca (se replanifica desde allí).
 * - Lo colocado en semanas anteriores que aún no ha pasado (desde hoy) cuenta como cubierto;
 *   lo que ya pasó sin completarse vuelve a planificarse.
 * - Se planifica lo pendiente: estimado − fichado − cubierto.
 */
export async function loadPendingAdHocTasksForScheduling(
  naveId: string,
  weekStart: Date,
  now: Date = new Date(),
): Promise<PendingAdHocTaskForScheduling[]> {
  const monday = utcDayStart(weekStart);
  const nextWeekStart = new Date(monday.getTime() + 7 * DAY_MS);
  const today = utcDayStart(now);
  const tasks = await prisma.task.findMany({
    where: {
      naveId,
      systemKind: TaskSystemKind.AD_HOC,
      isCompleted: false,
      estimatedHours: { gt: 0 },
      participants: { some: {} },
      assignments: { none: { date: { gte: nextWeekStart } } },
    },
    select: {
      id: true,
      process: true,
      estimatedHours: true,
      participants: { select: { personId: true } },
      timeEntries: { select: { userId: true, hours: true } },
      assignments: {
        where: { date: { lt: monday, gte: today } },
        select: { date: true, startSlot: true, endSlot: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return tasks.flatMap((task) => {
    // Los participantes trabajan juntos: el avance es lo que más ha fichado uno de ellos.
    const loggedByUser = new Map<string, number>();
    for (const e of task.timeEntries) {
      loggedByUser.set(e.userId, (loggedByUser.get(e.userId) ?? 0) + (e.hours ?? 0));
    }
    const logged = Math.max(0, ...loggedByUser.values());
    // Una fila por participante y tramo: cada tramo cuenta una vez.
    const chunks = new Map<string, number>();
    for (const a of task.assignments) {
      chunks.set(`${a.date.getTime()}|${a.startSlot}|${a.endSlot}`, a.endSlot - a.startSlot);
    }
    const covered = [...chunks.values()].reduce((sum, h) => sum + h, 0);
    const toPlan = roundUpToQuarter(Math.max(0, task.estimatedHours - logged - covered));
    if (toPlan <= 0) return [];
    return [
      {
        id: task.id,
        process: task.process,
        estimatedHours: toPlan,
        participantIds: task.participants.map((row) => row.personId),
      },
    ];
  });
}

export function scheduleAdHocTasksDetailed(
  pendingTasks: PendingAdHocTaskForScheduling[],
  args: ScheduleAdHocTasksArgs,
): AdHocScheduleResult {
  const slices: OverrideAssignmentSlice[] = [];
  const unplaced: UnplacedAdHocHours[] = [];
  const occupied = [...args.occupied];
  const availability = args.availability ?? (() => STANDARD_DAY);
  const dates = schedulableDates(args.weekStart, args.firstSchedulableDayIndex);

  for (const task of pendingTasks) {
    if (args.onlyTaskIds && !args.onlyTaskIds.has(task.id)) continue;
    if (args.alreadyPlannedTaskIds.has(task.id)) continue;
    if (task.participantIds.length === 0) continue;
    const hours = roundUpToQuarter(task.estimatedHours);
    if (hours <= 0) continue;

    const freeByDate = dates.map((date) => ({
      date,
      free: commonFreeIntervals({ personIds: task.participantIds, date, occupied, availability }),
    }));

    // Preferimos un único bloque seguido; si no existe, se trocea en los primeros huecos comunes.
    const chunks: Array<{ date: Date; start: number; end: number }> = [];
    const single = freeByDate
      .flatMap(({ date, free }) => free.map((i) => ({ date, ...i })))
      .find((i) => i.end - i.start >= hours - EPS);
    let remaining = hours;
    if (single) {
      chunks.push({ date: single.date, start: single.start, end: roundSlot(single.start + hours) });
      remaining = 0;
    } else {
      for (const { date, free } of freeByDate) {
        for (const i of free) {
          if (remaining <= EPS) break;
          const take = Math.min(remaining, i.end - i.start);
          chunks.push({ date, start: i.start, end: roundSlot(i.start + take) });
          remaining = roundSlot(remaining - take);
        }
      }
    }

    for (const chunk of chunks) {
      for (const personId of task.participantIds) {
        const assignment: OverrideAssignmentSlice = {
          taskId: task.id,
          personId,
          date: chunk.date,
          startSlot: chunk.start,
          endSlot: chunk.end,
          hours: roundSlot(chunk.end - chunk.start),
          process: task.process,
          isAfternoon: chunk.start >= MORNING_END - MORNING_START,
        };
        slices.push(assignment);
        occupied.push(assignment);
      }
    }
    if (remaining > EPS) unplaced.push({ taskId: task.id, hours: remaining });
  }

  return { slices, unplaced };
}

/** Avisos de planning para las horas de imprevista que no caben en la semana. */
export function adHocUnplacedWarnings(
  unplaced: UnplacedAdHocHours[],
): Array<{ taskId: string; reason: string }> {
  return unplaced.map((u) => ({
    taskId: u.taskId,
    reason: `${u.hours.toFixed(2)}h de imprevista sin hueco común esta semana (se colocarán al generar la siguiente)`,
  }));
}

export function schedulePendingAdHocTasks(
  pendingTasks: PendingAdHocTaskForScheduling[],
  args: ScheduleAdHocTasksArgs,
): OverrideAssignmentSlice[] {
  return scheduleAdHocTasksDetailed(pendingTasks, args).slices;
}

/**
 * Franjas de trabajo reales de los participantes (horario semanal y excepciones), menos festivos
 * y ausencias. Mismas reglas que el solver: un día sin horario configurado usa la jornada estándar.
 */
export async function loadAdHocAvailability(
  weekStart: Date,
  pendingTasks: PendingAdHocTaskForScheduling[],
): Promise<AdHocAvailability> {
  const personIds = [...new Set(pendingTasks.flatMap((task) => task.participantIds))];
  if (personIds.length === 0) return () => STANDARD_DAY;
  const monday = utcDayStart(weekStart);
  const friday = new Date(monday.getTime() + 4 * DAY_MS);

  const [people, holidays, absences] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: personIds } },
      select: {
        id: true,
        workWindows: true,
        scheduleOverrides: {
          where: { date: { gte: monday, lte: friday } },
          include: { windows: true },
        },
      },
    }),
    prisma.holiday.findMany({
      where: { startDate: { lte: friday }, endDate: { gte: monday } },
      select: { startDate: true, endDate: true },
    }),
    prisma.absence.findMany({
      where: { personId: { in: personIds }, ...absenceOverlapPrismaFilter(monday, friday) },
    }),
  ]);

  const byKey = new Map<string, SlotInterval[]>();
  for (let dayIndex = 0; dayIndex < 5; dayIndex += 1) {
    const date = new Date(monday.getTime() + dayIndex * DAY_MS);
    const iso = date.toISOString().slice(0, 10);
    const isHoliday = holidays.some(
      (h) =>
        iso >= utcDayStart(h.startDate).toISOString().slice(0, 10) &&
        iso <= utcDayStart(h.endDate).toISOString().slice(0, 10),
    );
    for (const person of people) {
      const key = `${person.id}|${iso}`;
      if (isHoliday) {
        byKey.set(key, []);
        continue;
      }
      const weekly: PersonScheduleDayInput[] =
        person.workWindows.length > 0
          ? [...new Set(person.workWindows.map((w) => w.dayOfWeek))].map((dayOfWeek) => ({
              dayOfWeek,
              windows: person.workWindows.filter((w) => w.dayOfWeek === dayOfWeek),
            }))
          : defaultWeeklyTemplate();
      const override = person.scheduleOverrides.find((o) => isSameUtcDay(o.date, date));
      let slots = windowsToSlots(getWindowsForDate(date.getUTCDay(), weekly, override));
      for (const absence of absences) {
        if (absence.personId !== person.id || !absenceCoversCivilIso(absence, iso)) continue;
        const partial =
          !isFullDayAbsenceBlock(absence) &&
          !isRangeAbsence(absence) &&
          absence.blockStartMinutes !== null &&
          absence.blockEndMinutes !== null;
        slots = partial
          ? subtract(slots, {
              start: minuteToSlot(absence.blockStartMinutes!),
              end: minuteToSlot(absence.blockEndMinutes!),
            })
          : [];
      }
      byKey.set(key, slots);
    }
  }

  return (personId, date) =>
    byKey.get(`${personId}|${utcDayStart(date).toISOString().slice(0, 10)}`) ?? STANDARD_DAY;
}

export async function buildAdHocPlanningAssignmentsForNave(
  args: ScheduleAdHocTasksArgs,
): Promise<AdHocScheduleResult> {
  const pendingTasks = await loadPendingAdHocTasksForScheduling(args.naveId, args.weekStart);
  const availability = await loadAdHocAvailability(args.weekStart, pendingTasks);
  return scheduleAdHocTasksDetailed(pendingTasks, { ...args, availability });
}

export async function buildAdHocPlanningAssignmentsForNaves(args: {
  naveIds: string[];
  weekStart: Date;
  firstSchedulableDayIndex: number;
  occupied: OccupiedAssignmentSlice[];
  alreadyPlannedTaskIds: Set<string>;
}): Promise<AdHocScheduleResult> {
  const slices: OverrideAssignmentSlice[] = [];
  const unplaced: UnplacedAdHocHours[] = [];
  const occupied = [...args.occupied];
  const alreadyPlannedTaskIds = new Set(args.alreadyPlannedTaskIds);

  for (const naveId of args.naveIds) {
    const batch = await buildAdHocPlanningAssignmentsForNave({
      naveId,
      weekStart: args.weekStart,
      firstSchedulableDayIndex: args.firstSchedulableDayIndex,
      occupied,
      alreadyPlannedTaskIds,
    });
    slices.push(...batch.slices);
    unplaced.push(...batch.unplaced);
    occupied.push(...batch.slices);
    for (const assignment of batch.slices) {
      alreadyPlannedTaskIds.add(assignment.taskId);
    }
  }

  return { slices, unplaced };
}

export async function injectPendingAdHocIntoDraftPlanning(args: {
  naveId: string;
  taskIds?: string[];
}): Promise<{ scheduledCount: number; unplacedHours: number }> {
  const none = { scheduledCount: 0, unplacedHours: 0 };
  const weekStart = getMondayOf(new Date());
  const { year, week } = isoWeek(weekStart);

  const planning = await prisma.planning.findUnique({
    where: { naveId_year_week: { naveId: args.naveId, year, week } },
    select: { id: true, status: true, weekStart: true },
  });
  if (!planning || planning.status !== PlanningStatus.DRAFT) {
    return none;
  }

  const existing = await prisma.planningAssignment.findMany({
    where: { planningId: planning.id },
    select: {
      taskId: true,
      personId: true,
      date: true,
      startSlot: true,
      endSlot: true,
    },
  });

  const alreadyPlannedTaskIds = new Set(existing.map((row) => row.taskId));
  const firstSchedulableDayIndex = firstSchedulableDayIndexFromToday(planning.weekStart);
  if (firstSchedulableDayIndex >= 5) return none;

  const pendingTasks = await loadPendingAdHocTasksForScheduling(args.naveId, planning.weekStart);
  const availability = await loadAdHocAvailability(planning.weekStart, pendingTasks);
  const { slices: scheduled, unplaced } = scheduleAdHocTasksDetailed(pendingTasks, {
    naveId: args.naveId,
    weekStart: planning.weekStart,
    firstSchedulableDayIndex,
    occupied: existing,
    alreadyPlannedTaskIds,
    onlyTaskIds: args.taskIds ? new Set(args.taskIds) : undefined,
    availability,
  });
  const unplacedHours = unplaced.reduce((sum, u) => sum + u.hours, 0);

  if (scheduled.length === 0) return { scheduledCount: 0, unplacedHours };

  await prisma.planningAssignment.createMany({
    data: scheduled.map((assignment) => ({
      planningId: planning.id,
      taskId: assignment.taskId,
      personId: assignment.personId,
      date: assignment.date,
      startSlot: assignment.startSlot,
      endSlot: assignment.endSlot,
      hours: assignment.hours,
      process: assignment.process,
      isOverride: true,
      isAfternoon: assignment.isAfternoon,
    })),
  });

  return { scheduledCount: new Set(scheduled.map((row) => row.taskId)).size, unplacedHours };
}
