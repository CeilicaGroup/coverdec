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
  getEmpresaPeople,
  getHolidaysForRange,
  getPlanningForWeek,
} from "@/features/planning/queries";
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
  const [planning, people, holidays, absences] = await Promise.all([
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
    getEmpresaPeople(),
    getHolidaysForRange(days[0], days[4]),
    getAbsencesForRange(days[0], days[4]),
  ]);

  const holidayDates = expandHolidayRangesToIsoDays(
    holidays,
    days[0],
    days[days.length - 1] ?? days[0],
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

      <Card>
        <CardHeader>
          <CardTitle>Horas libres y ocupación por persona/día</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operario</TableHead>
                {days.map((d) => (
                  <TableHead key={d.toISOString()} className="text-center">
                    {formatShortDate(d)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Asignado</TableHead>
                <TableHead className="text-right">Libre</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((person) => {
                const personRows = days.map((d) => {
                  const key = d.toISOString().slice(0, 10);
                  const isHoliday = holidayDates.has(key);
                  const absence = absences.find(
                    (a) =>
                      a.personId === person.id &&
                      a.date.toISOString().slice(0, 10) === key,
                  );
                  const used = (planning?.assignments ?? [])
                    .filter(
                      (a) =>
                        a.personId === person.id &&
                        a.date.toISOString().slice(0, 10) === key,
                    )
                    .reduce((acc, a) => acc + a.hours, 0);
                  const cap = isHoliday
                    ? 0
                    : Math.max(0, person.capacityHours - (absence?.hours ?? 0));
                  return { cap, used, isHoliday, isAbsent: !!absence };
                });
                const totalCap = personRows.reduce((a, x) => a + x.cap, 0);
                const totalUsed = personRows.reduce((a, x) => a + x.used, 0);
                const free = Math.max(0, totalCap - totalUsed);
                return (
                  <TableRow key={person.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PersonAvatar
                          iniciales={person.iniciales}
                          color={person.color}
                          size={22}
                        />
                        <span className="text-sm font-semibold">{person.nombre}</span>
                      </div>
                    </TableCell>
                    {personRows.map((r, idx) => {
                      const pct = r.cap > 0 ? r.used / r.cap : 0;
                      const tone =
                        r.isHoliday || r.isAbsent
                          ? "bg-muted text-muted-foreground"
                          : pct >= 0.95
                            ? "bg-red-100 text-red-800"
                            : pct >= 0.5
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-green-100 text-green-800";
                      return (
                        <TableCell key={idx} className="text-center">
                          <span
                            className={cn(
                              "inline-block px-2 py-0.5 rounded-md text-[10px] font-bold",
                              tone,
                            )}
                          >
                            {r.isHoliday
                              ? "Festivo"
                              : r.isAbsent
                                ? "Ausente"
                                : `${formatHours(r.used)} / ${formatHours(r.cap)}`}
                          </span>
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {formatHours(totalUsed)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold text-emerald-600">
                      {formatHours(free)}
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
