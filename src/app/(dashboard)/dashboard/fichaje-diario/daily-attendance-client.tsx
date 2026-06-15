"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coffee, Pause, Play } from "lucide-react";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { FestivoRow } from "../festivos/festivos-client";
import { formatAbsenceDetail } from "@/features/people/absence-display";
import {
  absenceCoversCivilIso,
  civilIsoDaysCoveredByAbsence,
  effectiveAbsenceHoursOnDay,
} from "@/features/people/absence-model";
import { AbsenceForm } from "@/features/people/absence-form";
import { deleteAbsence } from "@/features/people/actions";
import { createHoliday, deleteHoliday, updateHoliday } from "@/features/holidays/actions";
import {
  adminCreateAttendanceBreak,
  adminDeleteAttendanceBreak,
  adminDeleteAttendanceSession,
  adminUpdateAttendanceBreak,
  adminUpsertAttendanceSession,
  createManualAttendanceSession,
  deleteOwnAttendanceSession,
  endBreak,
  startAttendance,
  startBreak,
  stopAttendance,
  updateOwnAttendanceSession,
} from "@/features/attendance/actions";
import {
  formatAttendanceSource,
  operarioCanDeleteSession,
  operarioCanEditSession,
} from "@/features/attendance/source-display";
import {
  breakMinutes,
  breakTotalMs,
  grossSessionMs,
  workedSessionMinutes,
  workedSessionSeconds,
  workedSessionSecondsWithLiveBreak,
} from "@/features/attendance/worked-minutes";
import {
  civilIsoFromLocalDate,
  expandCivilIsoRange,
  formatCivilIsoDate,
  formatMonthYearEs,
  localDateFromCivilIso,
} from "@/lib/civil-date";

interface PersonRow {
  id: string;
  userId: string | null;
  name: string;
  workWindows: { dayOfWeek: number; startMinutes: number; endMinutes: number }[];
}

interface BreakRow {
  id: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  notes: string | null;
}

interface SessionRow {
  id: string;
  userId: string;
  personId: string;
  source: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number | null;
  notes: string | null;
  breaks: BreakRow[];
}

interface AbsenceRow {
  id: string;
  personId: string;
  date: string;
  endDate: string;
  hours: number;
  reason: string | null;
  blockStartMinutes: number | null;
  blockEndMinutes: number | null;
}

function dayTooltipText(modifiers: Record<string, boolean>): string {
  const labels: string[] = [];
  if (modifiers.withSession) labels.push("Tiene fichajes");
  if (modifiers.withAbsence) labels.push("Tiene ausencia");
  if (modifiers.withHoliday) labels.push("Festivo de empresa");
  if (labels.length === 0) return "Día sin incidencias";
  return labels.join(" · ");
}

function toTimeValue(dateIso: string): string {
  return new Date(dateIso).toISOString().slice(11, 16);
}

function formatHms(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(safe / 3600)).padStart(2, "0");
  const mm = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const ss = String(safe % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function sessionWorkedInput(session: SessionRow) {
  return {
    startedAt: new Date(session.startedAt),
    endedAt: session.endedAt ? new Date(session.endedAt) : null,
    breaks: session.breaks.map((b) => ({
      startedAt: new Date(b.startedAt),
      endedAt: b.endedAt ? new Date(b.endedAt) : null,
      minutes: b.minutes,
    })),
  };
}

function sessionNetMinutes(session: SessionRow, at: Date): number {
  if (session.endedAt != null && session.minutes != null) {
    return session.minutes;
  }
  return workedSessionMinutes(sessionWorkedInput(session), at);
}

export function DailyAttendanceClient(props: {
  canManage: boolean;
  currentUserId: string;
  currentPersonId: string | null;
  people: PersonRow[];
  sessions: SessionRow[];
  absences: AbsenceRow[];
  holidays: FestivoRow[];
  openSession: { id: string; startedAt: string } | null;
  openBreak: { id: string; sessionId: string; startedAt: string } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [personId, setPersonId] = useState<string>(props.currentPersonId ?? props.people[0]?.id ?? "");
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("14:00");
  const [editingAbsenceId, setEditingAbsenceId] = useState<string | null>(null);
  const [holidayStartDate, setHolidayStartDate] = useState(civilIsoFromLocalDate(new Date()));
  const [holidayEndDate, setHolidayEndDate] = useState(civilIsoFromLocalDate(new Date()));
  const [holidayName, setHolidayName] = useState("");
  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [addingBreakSessionId, setAddingBreakSessionId] = useState<string | null>(null);
  const [editingBreakId, setEditingBreakId] = useState<string | null>(null);
  const [breakStartTime, setBreakStartTime] = useState("10:00");
  const [breakEndTime, setBreakEndTime] = useState("10:15");
  const [localOnBreak, setLocalOnBreak] = useState(false);
  const [activeBreakStartedAt, setActiveBreakStartedAt] = useState<string | null>(null);
  const [frozenBreak, setFrozenBreak] = useState<{
    id?: string;
    startedAt: string;
    endedAt: string;
  } | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [sessionEditStartTime, setSessionEditStartTime] = useState("08:00");
  const [sessionEditEndTime, setSessionEditEndTime] = useState("14:00");

  const selectedIso = civilIsoFromLocalDate(selectedDate);
  const visiblePersonId = props.canManage ? personId : props.currentPersonId;
  const selectedPersonName = props.people.find((p) => p.id === personId)?.name ?? "Selecciona persona";
  const holidaysSorted = useMemo(
    () => [...props.holidays].sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [props.holidays],
  );

  const sessionsForDay = useMemo(() => {
    return props.sessions
      .filter((s) => s.personId === visiblePersonId && s.startedAt.slice(0, 10) === selectedIso)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [props.sessions, selectedIso, visiblePersonId]);

  const absencesForDay = useMemo(
    () =>
      props.absences.filter(
        (a) =>
          a.personId === visiblePersonId &&
          absenceCoversCivilIso(
            {
              date: new Date(`${a.date}T00:00:00.000Z`),
              endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            },
            selectedIso,
          ),
      ),
    [props.absences, visiblePersonId, selectedIso],
  );

  const editingAbsence = useMemo(
    () =>
      editingAbsenceId
        ? props.absences.find((a) => a.id === editingAbsenceId) ?? null
        : null,
    [editingAbsenceId, props.absences],
  );
  const absencesForMonth = useMemo(
    () =>
      props.absences
        .filter((a) => {
          if (a.personId !== visiblePersonId) return false;
          const month = selectedIso.slice(0, 7);
          return (
            a.date.slice(0, 7) === month ||
            a.endDate.slice(0, 7) === month ||
            (a.date.slice(0, 7) < month && a.endDate.slice(0, 7) > month)
          );
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
    [props.absences, visiblePersonId, selectedIso],
  );

  const personAbsenceIsos = useMemo(() => {
    const isos = new Set<string>();
    for (const a of props.absences.filter((row) => row.personId === visiblePersonId)) {
      for (const iso of civilIsoDaysCoveredByAbsence({
        date: new Date(`${a.date}T00:00:00.000Z`),
        endDate: new Date(`${a.endDate}T00:00:00.000Z`),
      })) {
        isos.add(iso);
      }
    }
    return isos;
  }, [props.absences, visiblePersonId]);

  const holidayDays = useMemo(() => {
    const days: Date[] = [];
    for (const row of props.holidays) {
      for (const iso of expandCivilIsoRange(row.startDate, row.endDate)) {
        if (personAbsenceIsos.has(iso)) continue;
        days.push(localDateFromCivilIso(iso));
      }
    }
    return days;
  }, [props.holidays, personAbsenceIsos]);

  const sessionDays = useMemo(
    () => props.sessions.filter((s) => s.personId === visiblePersonId).map((s) => new Date(s.startedAt)),
    [props.sessions, visiblePersonId],
  );
  const absenceDays = useMemo(() => {
    const days: Date[] = [];
    for (const a of props.absences.filter((row) => row.personId === visiblePersonId)) {
      for (const iso of civilIsoDaysCoveredByAbsence({
        date: new Date(`${a.date}T00:00:00.000Z`),
        endDate: new Date(`${a.endDate}T00:00:00.000Z`),
      })) {
        days.push(localDateFromCivilIso(iso));
      }
    }
    return days;
  }, [props.absences, visiblePersonId]);

  const todayIso = civilIsoFromLocalDate(new Date());
  const visiblePerson = props.people.find((p) => p.id === visiblePersonId) ?? null;
  const todayWeekday = (() => {
    const d = new Date().getDay();
    if (d === 0 || d === 6) return 5;
    return d;
  })();

  const targetTodayMinutes = useMemo(() => {
    if (!visiblePerson) return 0;
    const workMinutes = visiblePerson.workWindows
      .filter((w) => w.dayOfWeek === todayWeekday)
      .reduce((acc, w) => acc + Math.max(0, w.endMinutes - w.startMinutes), 0);
    const absenceMinutes = props.absences
      .filter(
        (a) =>
          a.personId === visiblePerson.id &&
          absenceCoversCivilIso(
            {
              date: new Date(`${a.date}T00:00:00.000Z`),
              endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            },
            todayIso,
          ),
      )
      .reduce((acc, a) => {
        const hours = effectiveAbsenceHoursOnDay(
          {
            date: new Date(`${a.date}T00:00:00.000Z`),
            endDate: new Date(`${a.endDate}T00:00:00.000Z`),
            hours: a.hours,
            blockStartMinutes: a.blockStartMinutes,
            blockEndMinutes: a.blockEndMinutes,
          },
          todayIso,
          visiblePerson.workWindows,
        );
        return acc + Math.round(hours * 60);
      }, 0);
    return Math.max(0, workMinutes - absenceMinutes);
  }, [props.absences, todayIso, todayWeekday, visiblePerson]);

  const isWorking = props.openSession != null;
  const isOnBreak = localOnBreak;

  const liveBreakState = useMemo(() => {
    const frozenBreaks =
      frozenBreak != null
        ? [
            {
              startedAt: new Date(frozenBreak.startedAt),
              endedAt: new Date(frozenBreak.endedAt),
            },
          ]
        : [];
    return {
      activeBreakStartedAt:
        localOnBreak && (activeBreakStartedAt ?? props.openBreak?.startedAt)
          ? new Date(activeBreakStartedAt ?? props.openBreak!.startedAt)
          : null,
      frozenBreaks,
    };
  }, [activeBreakStartedAt, frozenBreak, localOnBreak, props.openBreak?.startedAt]);

  const workedTodaySeconds = useMemo(() => {
    if (!visiblePerson) return 0;
    const at = new Date(nowMs);
    return props.sessions
      .filter((s) => s.personId === visiblePerson.id && s.startedAt.slice(0, 10) === todayIso)
      .reduce((acc, s) => {
        const input = sessionWorkedInput(s);
        const isLiveOpenSession = props.openSession?.id === s.id && s.endedAt == null;
        if (isLiveOpenSession) {
          return acc + workedSessionSecondsWithLiveBreak(input, at, liveBreakState);
        }
        return acc + workedSessionSeconds(input, at);
      }, 0);
  }, [
    liveBreakState,
    nowMs,
    props.openSession?.id,
    props.sessions,
    todayIso,
    visiblePerson,
  ]);

  useEffect(() => {
    if (props.openBreak) {
      setLocalOnBreak(true);
      setActiveBreakStartedAt(props.openBreak.startedAt);
      setFrozenBreak(null);
      return;
    }
    if (!frozenBreak) {
      setLocalOnBreak(false);
      setActiveBreakStartedAt(null);
    }
  }, [frozenBreak, props.openBreak]);

  useEffect(() => {
    if (!frozenBreak || !props.openSession) return;
    const session = props.sessions.find((s) => s.id === props.openSession!.id);
    const synced = session?.breaks.some(
      (b) =>
        b.endedAt != null &&
        (frozenBreak.id ? b.id === frozenBreak.id : b.startedAt === frozenBreak.startedAt),
    );
    if (synced) {
      setFrozenBreak(null);
      setLocalOnBreak(false);
      setActiveBreakStartedAt(null);
    }
  }, [frozenBreak, props.openSession, props.sessions]);

  useEffect(() => {
    if (props.openSession == null) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [props.openSession]);

  const targetTodaySeconds = Math.max(0, targetTodayMinutes * 60);

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle>Calendario</CardTitle>
          {props.canManage ? (
            <Select value={personId} onValueChange={(value) => value && setPersonId(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona persona">{selectedPersonName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {props.people.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <Calendar
              mode="single"
              className="[--cell-size:--spacing(10)]"
              selected={selectedDate}
              onSelect={(d) => {
                if (!d) return;
                setSelectedDate(d);
                setEditingAbsenceId(null);
              }}
              modifiers={{
                withSession: sessionDays,
                withAbsence: absenceDays,
                withHoliday: holidayDays,
              }}
              modifiersClassNames={{
                withSession: "bg-primary/20",
                withAbsence: "bg-destructive/20",
                withHoliday: "bg-amber-500/20",
              }}
              components={{
                DayButton: ({ modifiers, ...dayProps }) => (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span>
                          <CalendarDayButton modifiers={modifiers} {...dayProps} />
                        </span>
                      }
                    />
                    <TooltipContent>
                      <p>{dayTooltipText(modifiers as Record<string, boolean>)}</p>
                    </TooltipContent>
                  </Tooltip>
                ),
              }}
            />
          </TooltipProvider>
          <div className="mt-4 flex flex-wrap gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-primary/20 border border-primary/40" />
              <span>Día con fichajes</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-destructive/20 border border-destructive/40" />
              <span>Día con ausencia</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500/40" />
              <span>Festivo de empresa</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Fichaje del día {formatCivilIsoDate(selectedIso)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!props.canManage ? (
              <div className="space-y-4">
                <div className="rounded-lg border p-5">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                    Tiempo actual / tiempo objetivo
                  </p>
                  <p className="font-mono text-5xl md:text-6xl font-bold tabular-nums">
                    {formatHms(workedTodaySeconds)} / {formatHms(targetTodaySeconds)}
                  </p>
                  {isOnBreak ? (
                    <p className="mt-2 text-sm text-amber-600">En descanso — el contador de trabajo está en pausa</p>
                  ) : null}
                  <div className="mt-5 flex flex-wrap gap-6">
                    <div className="flex flex-col items-center gap-1.5">
                      <Button
                        size="lg"
                        className="size-14"
                        variant={isWorking ? "default" : "outline"}
                        disabled={pending}
                        onClick={() =>
                          startTransition(async () => {
                            if (isWorking) {
                              const result = await stopAttendance({ sessionId: props.openSession?.id });
                              const outcome = handleActionResult("fichaje.stop", result);
                              if (!outcome.success) {
                                toast.error(outcome.message);
                                return;
                              }
                              setFrozenBreak(null);
                              setLocalOnBreak(false);
                              setActiveBreakStartedAt(null);
                              toast.success("Jornada finalizada");
                            } else {
                              const result = await startAttendance();
                              const outcome = handleActionResult("fichaje.start", result);
                              if (!outcome.success) {
                                toast.error(outcome.message);
                                return;
                              }
                              toast.success("Fichaje iniciado");
                            }
                            router.refresh();
                          })
                        }
                        title={isWorking ? "Finalizar jornada" : "Iniciar jornada"}
                      >
                        {isWorking ? <Pause className="size-5" /> : <Play className="size-5" />}
                      </Button>
                      <span className="text-xs text-muted-foreground text-center">
                        {isWorking ? "Finalizar jornada" : "Iniciar jornada"}
                      </span>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      <Button
                        size="lg"
                        className="size-14"
                        variant={isOnBreak ? "secondary" : "outline"}
                        disabled={pending || !isWorking}
                        onClick={() =>
                          startTransition(async () => {
                            if (isOnBreak) {
                              const endedAt = new Date().toISOString();
                              const startedAt =
                                props.openBreak?.startedAt ?? activeBreakStartedAt ?? endedAt;
                              setLocalOnBreak(false);
                              setActiveBreakStartedAt(null);
                              setFrozenBreak({
                                id: props.openBreak?.id,
                                startedAt,
                                endedAt,
                              });
                              setNowMs(Date.now());
                              const result = await endBreak({ breakId: props.openBreak?.id });
                              const outcome = handleActionResult("fichaje.endBreak", result);
                              if (!outcome.success) {
                                setFrozenBreak(null);
                                setLocalOnBreak(props.openBreak != null);
                                setActiveBreakStartedAt(props.openBreak?.startedAt ?? null);
                                toast.error(outcome.message);
                                return;
                              }
                              toast.success("Descanso finalizado");
                            } else {
                              setLocalOnBreak(true);
                              setFrozenBreak(null);
                              const result = await startBreak({ sessionId: props.openSession?.id });
                              const outcome = handleActionResult("fichaje.startBreak", result);
                              if (!outcome.success) {
                                setLocalOnBreak(false);
                                toast.error(outcome.message);
                                return;
                              }
                              toast.success("Descanso iniciado");
                            }
                            router.refresh();
                          })
                        }
                        title={isOnBreak ? "Finalizar descanso" : "Iniciar descanso"}
                      >
                        {isOnBreak ? <Pause className="size-5" /> : <Coffee className="size-5" />}
                      </Button>
                      <span className="text-xs text-muted-foreground text-center">
                        {isOnBreak ? "Finalizar descanso" : "Iniciar descanso"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-3">
                  <p className="text-sm font-medium">Registro manual</p>
                  <p className="text-xs text-muted-foreground">
                    Para olvidos de fichaje. No sustituye al fichaje en vivo; cierra primero cualquier
                    jornada activa.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label>Inicio</Label>
                      <Input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        disabled={isWorking}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>Fin</Label>
                      <Input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        disabled={isWorking}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        className="w-full"
                        disabled={pending || isWorking}
                        onClick={() =>
                          startTransition(async () => {
                            const result = await createManualAttendanceSession({
                              date: selectedIso,
                              startTime,
                              endTime,
                            });
                            const outcome = handleActionResult("fichaje.createManual", result);
                            if (!outcome.success) {
                              toast.error(outcome.message);
                              return;
                            }
                            toast.success("Franja manual registrada");
                            router.refresh();
                          })
                        }
                      >
                        Registrar franja manual
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-4">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button
                    disabled={pending || !visiblePersonId}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await adminUpsertAttendanceSession({
                            personId: visiblePersonId!,
                            date: selectedIso,
                            startTime,
                            endTime,
                          });
                        const outcome = handleActionResult("fichaje.adminUpsert", result);
                        if (!outcome.success) {
                          toast.error(outcome.message);
                          return;
                        }
                        toast.success("Franja de fichaje guardada");
                        router.refresh();
                      })
                    }
                  >
                    Añadir franja
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {sessionsForDay.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin fichajes para este día.</p>
              ) : (
                sessionsForDay.map((session) => {
                  const at = new Date(nowMs);
                  const workedInput = sessionWorkedInput(session);
                  const grossMin = Math.round(grossSessionMs(workedInput, at) / 60_000);
                  const breakMin = Math.round(breakTotalMs(workedInput, at) / 60_000);
                  const netMin = sessionNetMinutes(session, at);
                  const editingBreak = editingBreakId
                    ? session.breaks.find((b) => b.id === editingBreakId) ?? null
                    : null;
                  const showBreakForm =
                    props.canManage &&
                    session.endedAt != null &&
                    (addingBreakSessionId === session.id || editingBreak != null);
                  const showSessionEditForm =
                    !props.canManage &&
                    editingSessionId === session.id &&
                    operarioCanEditSession(session);
                  const canEditSession =
                    !props.canManage && operarioCanEditSession(session);
                  const canDeleteSession =
                    !props.canManage && operarioCanDeleteSession(session);

                  return (
                    <div key={session.id} className="rounded border p-3 text-sm space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <span>
                          <span className="mr-2 inline-block rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            {formatAttendanceSource(session.source)}
                          </span>
                          {toTimeValue(session.startedAt)} -{" "}
                          {session.endedAt ? toTimeValue(session.endedAt) : "abierto"} · {netMin} min
                          trabajados
                          {breakMin > 0 ? (
                            <span className="text-muted-foreground">
                              {" "}
                              ({grossMin} min − {breakMin} min pausas)
                            </span>
                          ) : null}
                        </span>
                        {props.canManage ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive shrink-0"
                            onClick={() =>
                              startTransition(async () => {
                                const result = await adminDeleteAttendanceSession({
                                  sessionId: session.id,
                                });
                                const outcome = handleActionResult("fichaje.adminDelete", result);
                                if (!outcome.success) {
                                  toast.error(outcome.message);
                                  return;
                                }
                                toast.success("Fichaje eliminado");
                                if (addingBreakSessionId === session.id) setAddingBreakSessionId(null);
                                if (editingBreakId && session.breaks.some((b) => b.id === editingBreakId)) {
                                  setEditingBreakId(null);
                                }
                                router.refresh();
                              })
                            }
                          >
                            Eliminar
                          </Button>
                        ) : canEditSession || canDeleteSession ? (
                          <div className="flex gap-1 shrink-0">
                            {canEditSession ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setEditingSessionId(session.id);
                                  setSessionEditStartTime(toTimeValue(session.startedAt));
                                  setSessionEditEndTime(
                                    session.endedAt ? toTimeValue(session.endedAt) : "14:00",
                                  );
                                }}
                              >
                                Editar
                              </Button>
                            ) : null}
                            {canDeleteSession ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() =>
                                  startTransition(async () => {
                                    const result = await deleteOwnAttendanceSession({
                                      sessionId: session.id,
                                    });
                                    const outcome = handleActionResult(
                                      "fichaje.deleteOwn",
                                      result,
                                    );
                                    if (!outcome.success) {
                                      toast.error(outcome.message);
                                      return;
                                    }
                                    toast.success("Registro manual eliminado");
                                    if (editingSessionId === session.id) setEditingSessionId(null);
                                    router.refresh();
                                  })
                                }
                              >
                                Eliminar
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>

                      {showSessionEditForm ? (
                        <div className="grid gap-2 md:grid-cols-4 border-t pt-2">
                          <div className="space-y-1">
                            <Label>Inicio</Label>
                            <Input
                              type="time"
                              value={sessionEditStartTime}
                              onChange={(e) => setSessionEditStartTime(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Fin</Label>
                            <Input
                              type="time"
                              value={sessionEditEndTime}
                              onChange={(e) => setSessionEditEndTime(e.target.value)}
                            />
                          </div>
                          <div className="md:col-span-2 flex items-end gap-2">
                            <Button
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await updateOwnAttendanceSession({
                                    sessionId: session.id,
                                    date: selectedIso,
                                    startTime: sessionEditStartTime,
                                    endTime: sessionEditEndTime,
                                  });
                                  const outcome = handleActionResult(
                                    "fichaje.updateOwn",
                                    result,
                                  );
                                  if (!outcome.success) {
                                    toast.error(outcome.message);
                                    return;
                                  }
                                  toast.success("Fichaje actualizado");
                                  setEditingSessionId(null);
                                  router.refresh();
                                })
                              }
                            >
                              Guardar
                            </Button>
                            <Button variant="outline" onClick={() => setEditingSessionId(null)}>
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {session.breaks.length > 0 ? (
                        <div className="space-y-1 border-l-2 border-muted pl-3">
                          {session.breaks.map((breakRow) => (
                            <div
                              key={breakRow.id}
                              className="flex items-center justify-between gap-2 text-muted-foreground"
                            >
                              <span>
                                {toTimeValue(breakRow.startedAt)} -{" "}
                                {breakRow.endedAt ? toTimeValue(breakRow.endedAt) : "abierta"} ·{" "}
                                {breakMinutes(
                                  {
                                    startedAt: new Date(breakRow.startedAt),
                                    endedAt: breakRow.endedAt ? new Date(breakRow.endedAt) : null,
                                    minutes: breakRow.minutes,
                                  },
                                  at,
                                )}{" "}
                                min pausa
                              </span>
                              {props.canManage && session.endedAt != null ? (
                                <div className="flex gap-1 shrink-0">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingBreakId(breakRow.id);
                                      setAddingBreakSessionId(null);
                                      setBreakStartTime(toTimeValue(breakRow.startedAt));
                                      setBreakEndTime(
                                        breakRow.endedAt ? toTimeValue(breakRow.endedAt) : "10:15",
                                      );
                                    }}
                                  >
                                    Editar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive"
                                    onClick={() =>
                                      startTransition(async () => {
                                        const result = await adminDeleteAttendanceBreak({
                                          breakId: breakRow.id,
                                        });
                                        const outcome = handleActionResult(
                                          "fichaje.adminDeleteBreak",
                                          result,
                                        );
                                        if (!outcome.success) {
                                          toast.error(outcome.message);
                                          return;
                                        }
                                        toast.success("Pausa eliminada");
                                        if (editingBreakId === breakRow.id) setEditingBreakId(null);
                                        router.refresh();
                                      })
                                    }
                                  >
                                    Eliminar
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {props.canManage && session.endedAt != null && !showBreakForm ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setAddingBreakSessionId(session.id);
                            setEditingBreakId(null);
                            setBreakStartTime("10:00");
                            setBreakEndTime("10:15");
                          }}
                        >
                          Añadir pausa
                        </Button>
                      ) : null}

                      {showBreakForm ? (
                        <div className="grid gap-2 md:grid-cols-4 border-t pt-2">
                          <div className="space-y-1">
                            <Label>Inicio pausa</Label>
                            <Input
                              type="time"
                              value={breakStartTime}
                              onChange={(e) => setBreakStartTime(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label>Fin pausa</Label>
                            <Input
                              type="time"
                              value={breakEndTime}
                              onChange={(e) => setBreakEndTime(e.target.value)}
                            />
                          </div>
                          <div className="md:col-span-2 flex items-end gap-2">
                            <Button
                              disabled={pending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = editingBreak
                                    ? await adminUpdateAttendanceBreak({
                                        breakId: editingBreak.id,
                                        startTime: breakStartTime,
                                        endTime: breakEndTime,
                                      })
                                    : await adminCreateAttendanceBreak({
                                        sessionId: session.id,
                                        startTime: breakStartTime,
                                        endTime: breakEndTime,
                                      });
                                  const outcome = handleActionResult(
                                    editingBreak ? "fichaje.adminUpdateBreak" : "fichaje.adminCreateBreak",
                                    result,
                                  );
                                  if (!outcome.success) {
                                    toast.error(outcome.message);
                                    return;
                                  }
                                  toast.success(editingBreak ? "Pausa actualizada" : "Pausa añadida");
                                  setAddingBreakSessionId(null);
                                  setEditingBreakId(null);
                                  router.refresh();
                                })
                              }
                            >
                              {editingBreak ? "Guardar pausa" : "Guardar pausa"}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => {
                                setAddingBreakSessionId(null);
                                setEditingBreakId(null);
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>

        {props.canManage && visiblePersonId ? (
          <Card>
            <CardHeader>
              <CardTitle>Ausencias</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <AbsenceForm
                key={`${editingAbsenceId ?? "new"}-${selectedIso}`}
                personId={visiblePersonId}
                selectedDateIso={editingAbsence?.date ?? selectedIso}
                editing={
                  editingAbsence
                    ? {
                        id: editingAbsence.id,
                        date: editingAbsence.date,
                        endDate: editingAbsence.endDate,
                        hours: editingAbsence.hours,
                        reason: editingAbsence.reason ?? "",
                        blockStartMinutes: editingAbsence.blockStartMinutes,
                        blockEndMinutes: editingAbsence.blockEndMinutes,
                      }
                    : null
                }
                pending={pending}
                onPendingChange={(fn) => startTransition(fn)}
                onSaved={() => {
                  setEditingAbsenceId(null);
                  router.refresh();
                }}
                onCancelEdit={() => setEditingAbsenceId(null)}
              />
              <div className="max-h-48 overflow-y-auto space-y-1">
                {absencesForDay.map((absence) => (
                  <p key={absence.id} className="text-sm text-muted-foreground">
                    {formatAbsenceDetail(absence)}
                  </p>
                ))}
              </div>
              <div className="border-t pt-3">
                <p className="text-sm font-medium mb-2">
                  Ausencias de {formatMonthYearEs(selectedIso)}
                </p>
                <div className="max-h-56 overflow-y-auto space-y-1">
                  {absencesForMonth.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin ausencias registradas este mes.</p>
                  ) : (
                    absencesForMonth.map((absence) => (
                      <div
                        key={`month-${absence.id}`}
                        className="flex items-center justify-between rounded border p-2 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {formatAbsenceDetail(absence)}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingAbsenceId(absence.id);
                              setSelectedDate(localDateFromCivilIso(absence.date));
                            }}
                          >
                            Editar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              startTransition(async () => {
                                const result = await deleteAbsence({
                                    id: absence.id,
                                    personId: visiblePersonId,
                                    date: absence.date,
                                  });
                                const outcome = handleActionResult("fichaje.absence.delete", result);
                                if (!outcome.success) {
                                  toast.error(outcome.message);
                                  return;
                                }
                                toast.success("Ausencia eliminada");
                                if (editingAbsenceId === absence.id) setEditingAbsenceId(null);
                                router.refresh();
                              })
                            }
                          >
                            Eliminar
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {props.canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Festivos de empresa</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Calendario laboral común (navidad, puente, etc.). Las vacaciones de cada operario
                se registran como ausencias, no aquí.
              </p>
              <div className="grid md:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Inicio</Label>
                  <Input
                    type="date"
                    lang="es-ES"
                    value={holidayStartDate}
                    onChange={(e) => setHolidayStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Fin</Label>
                  <Input
                    type="date"
                    lang="es-ES"
                    value={holidayEndDate}
                    onChange={(e) => setHolidayEndDate(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input value={holidayName} onChange={(e) => setHolidayName(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={pending || !holidayName.trim()}
                  onClick={() =>
                    startTransition(async () => {
                      const result = editingHolidayId
                        ? await updateHoliday({
                            id: editingHolidayId,
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                          })
                        : await createHoliday({
                            startDate: holidayStartDate,
                            endDate: holidayEndDate,
                            name: holidayName.trim(),
                          });
                      const outcome = handleActionResult(
                        editingHolidayId ? "fichaje.holiday.update" : "fichaje.holiday.create",
                        result,
                      );
                      if (!outcome.success) {
                        toast.error(outcome.message);
                        return;
                      }
                      toast.success(editingHolidayId ? "Festivo actualizado" : "Festivo creado");
                      setEditingHolidayId(null);
                      setHolidayName("");
                      setHolidayStartDate(selectedIso);
                      setHolidayEndDate(selectedIso);
                      router.refresh();
                    })
                  }
                >
                  {editingHolidayId ? "Guardar cambios" : "Añadir festivo"}
                </Button>
                {editingHolidayId ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingHolidayId(null);
                      setHolidayName("");
                    }}
                  >
                    Cancelar
                  </Button>
                ) : null}
              </div>
              <div className="max-h-56 overflow-y-auto space-y-2">
                {holidaysSorted.map((holiday) => (
                  <div key={holiday.id} className="flex items-center justify-between rounded border p-2 text-sm">
                    <span>
                      {formatCivilIsoDate(holiday.startDate)}
                      {holiday.startDate !== holiday.endDate
                        ? ` — ${formatCivilIsoDate(holiday.endDate)}`
                        : ""}{" "}
                      · {holiday.name}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingHolidayId(holiday.id);
                          setHolidayStartDate(holiday.startDate);
                          setHolidayEndDate(holiday.endDate);
                          setHolidayName(holiday.name);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          startTransition(async () => {
                            const result = await deleteHoliday({ id: holiday.id });
                            const outcome = handleActionResult("fichaje.holiday.delete", result);
                            if (!outcome.success) {
                              toast.error(outcome.message);
                              return;
                            }
                            toast.success("Festivo eliminado");
                            router.refresh();
                          })
                        }
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}

      </div>
    </div>
  );
}
