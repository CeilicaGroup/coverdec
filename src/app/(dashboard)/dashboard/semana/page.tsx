import { CalendarDays } from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  weekDays,
} from "@/lib/week";
import {
  getAbsencesForRange,
  getActualHoursForWeek,
  getNavePersonnel,
  getHolidaysForRange,
  getPlanningForWeek,
  getProcessBadgeStylesByCode,
  type ActualHourEntry,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { ViewToggle } from "../../_components/view-toggle";
import { PersonAvatar } from "@/components/person-avatar";
import {
  ProcessBadge,
  processColor,
  type ProcessBadgeStyle,
} from "@/components/process-badge";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { formatDayMonthYear, formatHours } from "@/lib/format";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

interface GridCell {
  id: string;
  hours: number;
  startSlot: number | null;
  endSlot: number | null;
  /** Overrides slot-derived label for actual entries: "HH:MM–HH:MM" */
  timeLabel: string | null;
  process: string;
  project: string;
  lamp: string | null;
}

function formatTimeRange(startedAt: Date, hours: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const startH = startedAt.getUTCHours();
  const startM = startedAt.getUTCMinutes();
  const totalMins = startH * 60 + startM + Math.round(hours * 60);
  const endH = Math.floor(totalMins / 60) % 24;
  const endM = totalMins % 60;
  return `${pad(startH)}:${pad(startM)}–${pad(endH)}:${pad(endM)}`;
}

export default async function SemanaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const view = params.view === "actual" ? "actual" : "plan";
  const weekIso = getMondayOf(weekStart).toISOString().slice(0, 10);

  const [people, holidays, absences, processStyles] = await Promise.all([
    getNavePersonnel(ctx.naveId),
    getHolidaysForRange(days[0], days[4]),
    getAbsencesForRange(days[0], days[4]),
    getProcessBadgeStylesByCode(),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    days[0],
    days[days.length - 1] ?? days[0],
  );

  let grid: Map<string, Map<string, GridCell[]>>;

  if (view === "actual") {
    const actualEntries = await getActualHoursForWeek({ naveId: ctx.naveId, weekStart });
    grid = buildActualGrid(actualEntries, people, days);
  } else {
    const planning = await getPlanningForWeek({ naveId: ctx.naveId, weekStart });
    grid = buildPlanGrid(planning, people, days);
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista semanal S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle basePath="/dashboard/semana" view={view} week={weekIso} />
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={weekIso}
            />
          </div>
        }
      />
      {view === "plan" && grid.size === 0 && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay planning generado para esta semana. Vuelve al Resumen y pulsa "Generar planning".
        </div>
      )}
      {view === "actual" && [...grid.values()].every((dm) => [...dm.values()].every((c) => c.length === 0)) && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay registros de horas para esta semana.
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" />
            {view === "actual" ? "Registros reales · persona × día" : "Grid semanal · persona × día"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="grid min-w-[960px]" style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}>
            <div className="bg-muted px-3 py-2 text-xs font-semibold border-b border-r">
              Operario
            </div>
            {days.map((d, idx) => {
              const isHoliday = holidayDates.has(d.toISOString().slice(0, 10));
              return (
                <div
                  key={d.toISOString()}
                  className="bg-muted px-3 py-2 text-xs font-semibold text-center border-b border-r last:border-r-0"
                >
                  {DAY_LABELS[idx]}
                  <div className="text-[10px] text-muted-foreground">
                    {formatDayMonthYear(d)}
                  </div>
                  {isHoliday && (
                    <div className="text-[10px] text-orange-600 font-bold mt-0.5">Festivo</div>
                  )}
                </div>
              );
            })}

            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                days={days}
                cells={grid.get(person.id) ?? new Map()}
                absences={absences.filter((a) => a.personId === person.id)}
                processStyles={processStyles}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PersonRow({
  person,
  days,
  cells,
  absences,
  processStyles,
}: {
  person: { id: string; nombre: string; iniciales: string; color: string };
  days: Date[];
  cells: Map<string, GridCell[]>;
  absences: { date: Date; reason: string | null }[];
  processStyles: Map<string, ProcessBadgeStyle>;
}) {
  return (
    <>
      <div className="px-3 py-2 border-b border-r flex items-center gap-2 bg-card">
        <PersonAvatar iniciales={person.iniciales} color={person.color} size={24} />
        <div className="overflow-hidden">
          <div className="text-xs font-semibold truncate">{person.nombre}</div>
        </div>
      </div>
      {days.map((d) => {
        const key = d.toISOString().slice(0, 10);
        const tasks = cells.get(key) ?? [];
        const isAbsent = absences.some(
          (a) => a.date.toISOString().slice(0, 10) === key,
        );
        return (
          <div
            key={key}
            className="border-b border-r last:border-r-0 px-1.5 py-1.5 min-h-[80px] space-y-1 bg-card"
          >
            {isAbsent ? (
              <div className="rounded bg-muted px-2 py-1 text-[10px] text-muted-foreground text-center">
                Ausencia
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded border border-dashed px-2 py-1 text-[10px] text-muted-foreground text-center">
                Libre
              </div>
            ) : (
              tasks.map((t) => {
                const colors = processColor(t.process, processStyles.get(t.process));
                return (
                  <div
                    key={t.id}
                    className="rounded px-1.5 py-1 border-l-[3px] text-[10px] leading-tight"
                    style={{
                      background: colors.bgColor,
                      borderColor: colors.borderColor,
                    }}
                  >
                    {(t.timeLabel ?? (t.startSlot !== null && t.endSlot !== null ? rangeLabel(t.startSlot, t.endSlot) : null)) && (
                      <div className="font-mono text-[9px] opacity-70">
                        {t.timeLabel ?? rangeLabel(t.startSlot!, t.endSlot!)}
                      </div>
                    )}
                    <div className="font-semibold truncate" style={{ color: colors.fgColor }}>
                      {t.project}
                    </div>
                    <div className="text-[9px] truncate opacity-80" style={{ color: colors.fgColor }}>
                      {t.lamp ?? ""}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <ProcessBadge
                        code={t.process}
                        definition={processStyles.get(t.process)}
                      />
                      <span
                        className="font-mono text-[9px] font-bold ml-auto"
                        style={{ color: colors.fgColor }}
                      >
                        {formatHours(t.hours)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </>
  );
}

function buildPlanGrid(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, GridCell[]>> {
  const grid = new Map<string, Map<string, GridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, GridCell[]>();
    for (const d of days) personMap.set(d.toISOString().slice(0, 10), []);
    grid.set(p.id, personMap);
  }
  if (!planning) return grid;
  for (const a of planning.assignments) {
    const personMap = grid.get(a.personId);
    if (!personMap) continue;
    const key = a.date.toISOString().slice(0, 10);
    const cell = personMap.get(key) ?? [];
    cell.push({
      id: a.id,
      hours: a.hours,
      startSlot: a.startSlot,
      endSlot: a.endSlot,
      timeLabel: null,
      process: a.process,
      project: a.task.project.name,
      lamp: a.task.lamp?.name ?? null,
    });
    personMap.set(key, cell);
  }
  return grid;
}

function buildActualGrid(
  entries: ActualHourEntry[],
  people: Awaited<ReturnType<typeof getNavePersonnel>>,
  days: Date[],
): Map<string, Map<string, GridCell[]>> {
  const grid = new Map<string, Map<string, GridCell[]>>();
  for (const p of people) {
    const personMap = new Map<string, GridCell[]>();
    for (const d of days) personMap.set(d.toISOString().slice(0, 10), []);
    grid.set(p.id, personMap);
  }
  for (const e of entries) {
    if (!e.personId) continue;
    const personMap = grid.get(e.personId);
    if (!personMap) continue;
    const cell = personMap.get(e.date) ?? [];
    cell.push({
      id: e.id,
      hours: e.hours,
      startSlot: null,
      endSlot: null,
      timeLabel: formatTimeRange(e.startedAt, e.hours),
      process: e.process ?? "—",
      project: e.project?.name ?? "—",
      lamp: e.lamp?.name ?? null,
    });
    personMap.set(e.date, cell);
  }
  return grid;
}
