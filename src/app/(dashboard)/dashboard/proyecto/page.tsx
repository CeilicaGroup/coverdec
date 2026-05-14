import { requireDashboardContext } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
} from "@/lib/week";
import {
  getActiveProjectsWithLoad,
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
import { ProcessBadge } from "@/components/process-badge";
import { PersonAvatar } from "@/components/person-avatar";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";
import { rangeLabel } from "@/features/planning/engine/slot-format";

export default async function ProyectoPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const [planning, projects] = await Promise.all([
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
    getActiveProjectsWithLoad(ctx.empresaId),
  ]);

  const byProject = new Map<string, typeof planning extends infer P ? P extends { assignments: infer A } ? A : [] : []>();
  for (const a of planning?.assignments ?? []) {
    const list = (byProject.get(a.task.projectId) ?? []) as typeof a[];
    list.push(a);
    byProject.set(a.task.projectId, list as never);
  }

  const projectsWithLoad = projects
    .map((p) => ({
      project: p,
      risk: riskFromDelivery(p.deliveryDate),
      pending: p.tasks.reduce((acc, t) => acc + t.pendingHours, 0),
    }))
    .filter((row) => row.pending > 0)
    .sort((a, b) => {
      const aDate = a.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDate = b.project.deliveryDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return aDate - bDate;
    });

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por proyecto · S${week} · ${year}`}
        description={formatWeekRange(weekStart)}
        actions={
          <WeekNav
            weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
            weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
          />
        }
      />

      <div className="space-y-4">
        {projectsWithLoad.map((row) => {
          const assignments = (byProject.get(row.project.id) ?? []) as Array<
            NonNullable<typeof planning>["assignments"][number]
          >;
          const scheduledHours = assignments.reduce((acc, a) => acc + a.hours, 0);
          return (
            <Card key={row.project.id}>
              <CardHeader className="flex flex-row items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">{row.project.name}</CardTitle>
                  <RiskBadge level={row.risk} />
                </div>
                <div className="text-xs text-muted-foreground flex gap-4">
                  <span>
                    Entrega:{" "}
                    <span className="font-mono font-semibold text-foreground">
                      {formatShortDate(row.project.deliveryDate)}
                    </span>
                  </span>
                  <span>
                    Días: <span className="font-semibold text-foreground">{daysUntil(row.project.deliveryDate) ?? "—"}</span>
                  </span>
                  <span>
                    Pendiente:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(row.pending)}
                    </span>
                  </span>
                  <span>
                    Asignado S{week}:{" "}
                    <span className="font-semibold text-foreground">
                      {formatHours(scheduledHours)}
                    </span>
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Horario</TableHead>
                      <TableHead>Operario</TableHead>
                      <TableHead>Lámpara</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={6}
                          className="text-center text-muted-foreground py-4"
                        >
                          Sin asignaciones esta semana
                        </TableCell>
                      </TableRow>
                    ) : (
                      assignments
                        .sort(
                          (a, b) =>
                            a.date.getTime() - b.date.getTime() ||
                            a.startSlot - b.startSlot,
                        )
                        .map((a) => (
                          <TableRow key={a.id}>
                            <TableCell className="font-mono text-xs">
                              {formatShortDate(a.date)}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {rangeLabel(a.startSlot, a.endSlot)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <PersonAvatar
                                  iniciales={a.person.iniciales}
                                  color={a.person.color}
                                  size={20}
                                />
                                <span className="text-xs">{a.person.alias ?? a.person.nombre}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs">
                              {a.task.lamp?.name ?? "—"}
                            </TableCell>
                            <TableCell>
                              <ProcessBadge code={a.process} />
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs font-semibold">
                              {formatHours(a.hours)}
                            </TableCell>
                          </TableRow>
                        ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
