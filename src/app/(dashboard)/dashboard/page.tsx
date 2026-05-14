import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { requireDashboardContext } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
  toUtcDay,
  weekDays,
} from "@/lib/week";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import {
  getAbsencesForRange,
  getActiveProjectsWithLoad,
  getEmpresaPeople,
  getHolidaysForRange,
  getPlanningForWeek,
  summarizePlanning,
} from "@/features/planning/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageHeader } from "../_components/page-header";
import { WeekNav } from "../_components/week-nav";
import { RiskBadge } from "@/components/risk-badge";
import { ProcessBadge } from "@/components/process-badge";
import { GenerateButton } from "./generate-button";

const DAY_LABELS = ["LUN", "MAR", "MIÉ", "JUE", "VIE"];

export default async function ResumenPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);

  const [planning, people, projects, holidays, absences] = await Promise.all([
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
    getEmpresaPeople(),
    getActiveProjectsWithLoad(ctx.empresaId),
    getHolidaysForRange(days[0], days[4]),
    getAbsencesForRange(days[0], days[4]),
  ]);

  const summary = summarizePlanning(planning);
  const capacity = computeCapacity(days, people, holidays, absences);

  const projectsWithRisk = projects
    .map((p) => ({
      project: p,
      risk: riskFromDelivery(p.deliveryDate),
      pending: p.tasks.reduce((acc, t) => acc + t.pendingHours, 0),
      daysLeft: daysUntil(p.deliveryDate),
    }))
    .filter((row) => row.pending > 0)
    .slice(0, 12);

  const atRisk = projectsWithRisk.filter((p) => p.risk === "RIESGO").length;
  const occupation = capacity.totalCapacity > 0
    ? Math.round((summary.totalHours / capacity.totalCapacity) * 100)
    : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Resumen S${week} · ${year}`}
        description={`Semana ${formatWeekRange(weekStart)}`}
        actions={
          <div className="flex items-center gap-2">
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
            />
            <GenerateButton
              weekStart={getMondayOf(weekStart).toISOString()}
              planningId={planning?.id ?? null}
              planningStatus={planning?.status ?? null}
              role={ctx.role}
            />
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          label="Capacidad equipo"
          value={`${formatHours(capacity.totalCapacity)}`}
          sub={`${people.length} operarios × 5 días`}
          icon={<Users className="size-4" />}
        />
        <Kpi
          label="Horas asignadas"
          value={`${formatHours(summary.totalHours)}`}
          sub={`${occupation}% ocupación`}
          icon={<TrendingUp className="size-4" />}
          highlight={occupation > 95 ? "warn" : occupation > 0 ? "ok" : "muted"}
        />
        <Kpi
          label="Proyectos en riesgo"
          value={String(atRisk)}
          sub="Entrega ≤ 7 días"
          icon={<AlertTriangle className="size-4" />}
          highlight={atRisk > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Estado planning"
          value={planning?.status === "PUBLISHED" ? "Publicado" : planning ? "Borrador" : "Sin generar"}
          sub={planning?.publishedAt ? formatShortDate(planning.publishedAt) : "Genera para empezar"}
          icon={planning ? <CheckCircle2 className="size-4" /> : <Sparkles className="size-4" />}
          highlight={planning?.status === "PUBLISHED" ? "ok" : "muted"}
        />
      </div>

      <div className="grid grid-cols-5 gap-3">
        {days.map((day, idx) => {
          const dayKey = day.toISOString().slice(0, 10);
          const used = summary.byDay.get(dayKey) ?? 0;
          const cap = capacity.byDay.get(dayKey) ?? 0;
          const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
          const isHoliday = holidays.some(
            (h) => h.date.toISOString().slice(0, 10) === dayKey,
          );
          return (
            <Card key={dayKey} className="text-center">
              <CardContent className="py-3">
                <div className="text-[10px] font-bold tracking-widest text-muted-foreground">
                  {DAY_LABELS[idx]} {day.getUTCDate()}/{day.getUTCMonth() + 1}
                </div>
                {isHoliday ? (
                  <div className="text-xs text-muted-foreground mt-2 italic">
                    Festivo
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-black mt-1">{pct}%</div>
                    <div className="h-1.5 rounded-full bg-secondary mt-2 overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background:
                            pct > 95
                              ? "var(--destructive)"
                              : pct > 80
                                ? "#A16207"
                                : "var(--primary)",
                        }}
                      />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {formatHours(used)} / {formatHours(cap)}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-4" />
            Proyectos activos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Días</TableHead>
                <TableHead>Procesos pendientes</TableHead>
                <TableHead className="text-right">Horas pend.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projectsWithRisk.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No hay proyectos activos con horas pendientes
                  </TableCell>
                </TableRow>
              ) : (
                projectsWithRisk.map((row) => {
                  const processes = Array.from(
                    new Set(
                      row.project.tasks
                        .filter((t) => t.pendingHours > 0)
                        .map((t) => t.process),
                    ),
                  );
                  return (
                    <TableRow key={row.project.id}>
                      <TableCell className="font-semibold">{row.project.name}</TableCell>
                      <TableCell>
                        <RiskBadge level={row.risk} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatShortDate(row.project.deliveryDate)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            row.daysLeft != null && row.daysLeft <= 7
                              ? "text-destructive font-bold"
                              : "text-muted-foreground"
                          }
                        >
                          {row.daysLeft != null ? `${row.daysLeft}d` : "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {processes.slice(0, 6).map((p) => (
                            <ProcessBadge key={p} code={p} />
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatHours(row.pending)}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {planning && planning.assignments.length === 0 && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
          Borrador generado sin asignaciones. Revisa los proyectos pendientes y vuelve a generar tras añadir tareas.
        </div>
      )}
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  highlight?: "ok" | "warn" | "muted";
}

function Kpi({ label, value, sub, icon, highlight }: KpiProps) {
  const valueColor =
    highlight === "ok"
      ? "text-emerald-600"
      : highlight === "warn"
        ? "text-red-600"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            {label}
          </div>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <div className={`text-3xl font-black mt-1 ${valueColor}`}>{value}</div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}

function computeCapacity(
  days: Date[],
  people: Awaited<ReturnType<typeof getEmpresaPeople>>,
  holidays: Awaited<ReturnType<typeof getHolidaysForRange>>,
  absences: Awaited<ReturnType<typeof getAbsencesForRange>>,
): { totalCapacity: number; byDay: Map<string, number> } {
  const byDay = new Map<string, number>();
  let total = 0;
  for (const day of days) {
    const key = day.toISOString().slice(0, 10);
    const isHoliday = holidays.some(
      (h) => h.date.toISOString().slice(0, 10) === key,
    );
    let cap = 0;
    if (!isHoliday) {
      for (const person of people) {
        const absence = absences.find(
          (a) =>
            a.personId === person.id &&
            a.date.toISOString().slice(0, 10) === key,
        );
        cap += Math.max(0, person.capacityHours - (absence?.hours ?? 0));
      }
    }
    byDay.set(key, cap);
    total += cap;
  }
  return { totalCapacity: total, byDay };
}

void toUtcDay;
