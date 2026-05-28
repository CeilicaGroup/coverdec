import { requireDashboardContext } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
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
  getPlanningWeekMeta,
} from "@/features/planning/queries";
import {
  computePersonDayCapacityHours,
  personScheduleContextFromPerson,
} from "@/features/planning/person-day-capacity";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PersonAvatar } from "@/components/person-avatar";
import { formatHours, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { expandHolidayRangesToIsoDays } from "@/lib/holidays";
import { getPlanningViewModeForContext } from "@/features/planning/planning-visibility";
import { PlanningEmptyNotice } from "../../_components/planning-empty-notice";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

function occupancyTone(used: number, cap: number): string {
  if (cap <= 0) return "bg-muted text-muted-foreground";
  const pct = used / cap;
  if (pct >= 0.95) return "bg-red-100 text-red-800";
  if (pct >= 0.5) return "bg-yellow-100 text-yellow-800";
  return "bg-green-100 text-green-800";
}

export default async function DisponibilidadPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);
  const viewMode = await getPlanningViewModeForContext(ctx);
  const naveScope = naveScopeFromContext(ctx);
  const [planning, planningMeta, people, holidays, absences, actualEntries] =
    await Promise.all([
      getPlanningForWeek({ naveScope, weekStart, viewMode }),
      getPlanningWeekMeta({ naveScope, weekStart }),
      getNavePersonnel(naveScope),
      getHolidaysForRange(days[0], days[4]),
      getAbsencesForRange(days[0], days[4]),
      getActualHoursForWeek({ naveScope, weekStart }),
    ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    days[0],
    days[days.length - 1] ?? days[0],
  );

  const scheduleByPerson = new Map(
    people.map((person) => [person.id, personScheduleContextFromPerson(person)]),
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Disponibilidad · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <WeekNav
            weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
            weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
          />
        }
      />

      <PlanningEmptyNotice
        hiddenDraft={
          viewMode === "published_only" &&
          planningMeta?.status === "DRAFT" &&
          !planning
        }
        noPublished={viewMode === "published_only" && !planningMeta && !planning}
      />

      <Card>
        <CardHeader>
          <CardTitle>Horas libres y ocupación por persona/día</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="align-middle py-3">
                  Operario
                </TableHead>
                {days.map((d, idx) => (
                  <TableHead
                    key={d.toISOString()}
                    colSpan={2}
                    className="text-center border-l py-2"
                  >
                    <div className="font-semibold">{DAY_LABELS[idx]}</div>
                    <div className="text-[10px] text-muted-foreground font-normal">
                      {formatShortDate(d)}
                    </div>
                  </TableHead>
                ))}
                <TableHead colSpan={2} className="text-center border-l py-2">
                  Plan
                </TableHead>
                <TableHead colSpan={2} className="text-center border-l py-2">
                  Registro
                </TableHead>
              </TableRow>
              <TableRow>
                {days.flatMap((d) => {
                  const iso = d.toISOString();
                  return [
                    <TableHead
                      key={`${iso}-plan`}
                      className="text-center text-[10px] border-l"
                    >
                      Plan
                    </TableHead>,
                    <TableHead key={`${iso}-actual`} className="text-center text-[10px]">
                      Reg.
                    </TableHead>,
                  ];
                })}
                <TableHead className="text-right text-[10px] border-l">Asig.</TableHead>
                <TableHead className="text-right text-[10px]">Libre</TableHead>
                <TableHead className="text-right text-[10px] border-l">Asig.</TableHead>
                <TableHead className="text-right text-[10px]">Libre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => {
                const schedule = scheduleByPerson.get(person.id)!;
                const dayRows = days.map((d) => {
                  const key = d.toISOString().slice(0, 10);
                  const isHoliday = holidayDates.has(key);
                  const absence = absences.find(
                    (a) =>
                      a.personId === person.id &&
                      a.date.toISOString().slice(0, 10) === key,
                  );
                  const cap = computePersonDayCapacityHours({
                    day: d,
                    weekly: schedule.weekly,
                    overrides: schedule.overrides,
                    absenceHours: absence?.hours ?? 0,
                    isHoliday,
                  });
                  const planUsed = (planning?.assignments ?? [])
                    .filter(
                      (a) =>
                        a.personId === person.id &&
                        a.date.toISOString().slice(0, 10) === key,
                    )
                    .reduce((acc, a) => acc + a.hours, 0);
                  const actualUsed = actualEntries
                    .filter((e) => e.personId === person.id && e.date === key)
                    .reduce((acc, e) => acc + e.hours, 0);
                  const statusLabel = isHoliday
                    ? "Festivo"
                    : cap <= 0.01 && absence
                      ? "Ausente"
                      : cap <= 0.01
                        ? "Sin jornada"
                        : null;
                  return { cap, planUsed, actualUsed, statusLabel };
                });

                const totalCap = dayRows.reduce((acc, row) => acc + row.cap, 0);
                const totalPlanUsed = dayRows.reduce((acc, row) => acc + row.planUsed, 0);
                const totalActualUsed = dayRows.reduce(
                  (acc, row) => acc + row.actualUsed,
                  0,
                );
                const planFree = Math.max(0, totalCap - totalPlanUsed);
                const actualFree = Math.max(0, totalCap - totalActualUsed);

                return (
                  <TableRow key={person.id}>
                    <TableCell className="py-3.5">
                      <div className="flex items-center gap-2">
                        <PersonAvatar
                          iniciales={person.iniciales}
                          color={person.color}
                          size={22}
                        />
                        <span className="text-sm font-semibold">{person.nombre}</span>
                      </div>
                    </TableCell>
                    {dayRows.flatMap((row, idx) => [
                      <TableCell
                        key={`${person.id}-plan-${idx}`}
                        className="text-center border-l py-3.5"
                      >
                        {row.statusLabel ? (
                          <DayStatusBadge label={row.statusLabel} />
                        ) : (
                          <HoursBadge
                            used={row.planUsed}
                            cap={row.cap}
                            tone={occupancyTone(row.planUsed, row.cap)}
                          />
                        )}
                      </TableCell>,
                      <TableCell
                        key={`${person.id}-actual-${idx}`}
                        className="text-center py-3.5"
                      >
                        {row.statusLabel ? (
                          <DayStatusBadge label={row.statusLabel} />
                        ) : (
                          <HoursBadge
                            used={row.actualUsed}
                            cap={row.cap}
                            tone={occupancyTone(row.actualUsed, row.cap)}
                          />
                        )}
                      </TableCell>,
                    ])}
                    <TableCell className="text-right font-mono text-sm font-semibold border-l py-3.5">
                      {formatHours(totalPlanUsed)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600 py-3.5">
                      {formatHours(planFree)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold border-l py-3.5">
                      {formatHours(totalActualUsed)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600 py-3.5">
                      {formatHours(actualFree)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DayStatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-block px-2 py-1 rounded-md text-[10px] font-bold bg-muted text-muted-foreground">
      {label}
    </span>
  );
}

function HoursBadge({
  used,
  cap,
  tone,
}: {
  used: number;
  cap: number;
  tone: string;
}) {
  return (
    <span
      className={cn(
        "inline-block px-2 py-1 rounded-md text-[10px] font-bold",
        tone,
      )}
    >
      {formatHours(used)} / {formatHours(cap)}
    </span>
  );
}
