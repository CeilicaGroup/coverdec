import { requireDashboardContext } from "@/lib/context";
import { formatWeekRange, parseWeekParam } from "@/lib/week";
import { getActiveProjectsWithLoad } from "@/features/planning/queries";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RiskBadge } from "@/components/risk-badge";
import {
  daysUntil,
  formatHours,
  formatShortDate,
  riskFromDelivery,
} from "@/lib/format";

export default async function GanttPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const projects = await getActiveProjectsWithLoad(ctx.empresaId);

  const rows = projects
    .map((p) => ({
      project: p,
      risk: riskFromDelivery(p.deliveryDate),
      pending: p.tasks.reduce((acc, t) => acc + t.pendingHours, 0),
      days: daysUntil(p.deliveryDate),
    }))
    .filter((r) => r.pending > 0);

  const maxDays = Math.max(30, ...rows.map((r) => Math.max(1, r.days ?? 30)));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Vista Gantt"
        description={`Proyectos activos · referencia ${formatWeekRange(weekStart)}`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Días restantes hasta entrega</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 && (
            <div className="text-sm text-muted-foreground">Sin proyectos pendientes.</div>
          )}
          {rows.map((row) => {
            const widthPct =
              row.days != null && row.days > 0 ? (row.days / maxDays) * 100 : 0;
            const color =
              row.risk === "RIESGO"
                ? "#B91C1C"
                : row.risk === "ATENCION"
                  ? "#A16207"
                  : "#15803D";
            return (
              <div key={row.project.id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{row.project.name}</span>
                    <RiskBadge level={row.risk} />
                  </div>
                  <div className="text-muted-foreground flex gap-3">
                    <span>{formatShortDate(row.project.deliveryDate)}</span>
                    <span>{row.days != null ? `${row.days} días` : "sin fecha"}</span>
                    <span className="font-semibold text-foreground">
                      {formatHours(row.pending)}
                    </span>
                  </div>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, widthPct)}%`,
                      background: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
