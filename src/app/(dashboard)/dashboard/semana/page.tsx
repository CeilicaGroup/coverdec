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
  getEmpresaPeople,
  getHolidaysForRange,
  getPlanningForWeek,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { PersonAvatar } from "@/components/person-avatar";
import { ProcessBadge, processColor } from "@/components/process-badge";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { formatHours } from "@/lib/format";

const DAY_LABELS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

export default async function SemanaPage({
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

  const grid = buildGrid(planning, people, days);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Vista semanal S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <WeekNav
            weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
            weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
          />
        }
      />
      {!planning && (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No hay planning generado para esta semana. Vuelve al Resumen y pulsa "Generar planning".
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="size-4" />
            Grid semanal · persona × día
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <div className="grid min-w-[960px]" style={{ gridTemplateColumns: "180px repeat(5, 1fr)" }}>
            <div className="bg-muted px-3 py-2 text-xs font-semibold border-b border-r">
              Operario
            </div>
            {days.map((d, idx) => {
              const isHoliday = holidays.some(
                (h) =>
                  h.date.toISOString().slice(0, 10) ===
                  d.toISOString().slice(0, 10),
              );
              return (
                <div
                  key={d.toISOString()}
                  className="bg-muted px-3 py-2 text-xs font-semibold text-center border-b border-r last:border-r-0"
                >
                  {DAY_LABELS[idx]}
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {d.getUTCDate()}/{d.getUTCMonth() + 1}
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
}: {
  person: { id: string; nombre: string; iniciales: string; color: string };
  days: Date[];
  cells: Map<string, ReturnType<typeof toCell>[]>;
  absences: { date: Date; reason: string | null }[];
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
                const colors = processColor(t.process);
                return (
                  <div
                    key={t.id}
                    className="rounded px-1.5 py-1 border-l-[3px] text-[10px] leading-tight"
                    style={{ background: colors.bg, borderColor: colors.border }}
                  >
                    <div className="font-mono text-[9px] opacity-70">
                      {rangeLabel(t.startSlot, t.endSlot)}
                    </div>
                    <div className="font-semibold truncate" style={{ color: colors.fg }}>
                      {t.project}
                    </div>
                    <div className="text-[9px] truncate opacity-80" style={{ color: colors.fg }}>
                      {t.lamp ?? ""}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <ProcessBadge code={t.process} />
                      <span
                        className="font-mono text-[9px] font-bold ml-auto"
                        style={{ color: colors.fg }}
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

function toCell(assignment: {
  id: string;
  hours: number;
  startSlot: number;
  endSlot: number;
  process: import("@/generated/prisma").ProcessCode;
  task: { project: { name: string }; lamp: { name: string } | null };
}) {
  return {
    id: assignment.id,
    hours: assignment.hours,
    startSlot: assignment.startSlot,
    endSlot: assignment.endSlot,
    process: assignment.process,
    project: assignment.task.project.name,
    lamp: assignment.task.lamp?.name ?? null,
  };
}

function buildGrid(
  planning: Awaited<ReturnType<typeof getPlanningForWeek>>,
  people: Awaited<ReturnType<typeof getEmpresaPeople>>,
  days: Date[],
) {
  const grid = new Map<string, Map<string, ReturnType<typeof toCell>[]>>();
  for (const p of people) {
    const personMap = new Map<string, ReturnType<typeof toCell>[]>();
    for (const d of days) {
      personMap.set(d.toISOString().slice(0, 10), []);
    }
    grid.set(p.id, personMap);
  }
  if (!planning) return grid;
  for (const a of planning.assignments) {
    const personMap = grid.get(a.personId);
    if (!personMap) continue;
    const key = a.date.toISOString().slice(0, 10);
    const cell = personMap.get(key) ?? [];
    cell.push(toCell(a));
    personMap.set(key, cell);
  }
  return grid;
}
