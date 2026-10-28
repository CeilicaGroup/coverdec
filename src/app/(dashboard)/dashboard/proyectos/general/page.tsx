import { Fragment } from "react";
import Link from "next/link";
import { Role } from "@/generated/prisma";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { naveScopeFromContext } from "@/lib/nave-filter";
import { cn } from "@/lib/utils";
import { formatHours, formatShortDate } from "@/lib/format";
import { PageHeader } from "../../../_components/page-header";
import { PrintTrigger } from "../../ordenes/[id]/print-trigger";
import { ProcessBadge } from "@/components/process-badge";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";
import {
  GENERAL_VIEW_STATUS_LABELS,
  listGeneralViewProjectOptions,
  loadGeneralView,
  type GeneralViewStatus,
  type GeneralViewTotals,
} from "@/features/reports/general-view";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const COLUMN_COUNT = 12;

const STATUS_CLASS: Record<GeneralViewStatus, string> = {
  PENDIENTE: "text-muted-foreground",
  EN_CURSO: "text-amber-700 dark:text-amber-400",
  TERMINADO: "text-emerald-700 dark:text-emerald-400",
};

export default async function ProyectosGeneralPage({
  searchParams,
}: {
  searchParams?: Promise<{ projectId?: string; finished?: string }>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const params = (await searchParams) ?? {};
  const includeFinished = params.finished === "1";

  const [view, projectOptions, processStyles] = await Promise.all([
    loadGeneralView({
      naveScope: naveScopeFromContext(ctx),
      projectId: params.projectId || undefined,
      includeFinished,
    }),
    listGeneralViewProjectOptions(),
    getProcessBadgeStylesByCode(),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Vista general"
        description={`${view.projects.length} proyectos · plan ${formatHours(view.totals.planHours)} · real ${formatHours(view.totals.realHours)}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/proyectos"
              className="no-print text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
            >
              Volver a proyectos
            </Link>
            <PrintTrigger />
          </div>
        }
      />

      <form className="no-print flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Proyecto</span>
          <select
            name="projectId"
            defaultValue={params.projectId ?? ""}
            className="h-9 min-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Todos</option>
            {projectOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="finished" value="1" defaultChecked={includeFinished} />
          Incluir terminados
        </label>
        <button
          type="submit"
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Filtrar
        </button>
      </form>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Entrega</TableHead>
                <TableHead>Lámpara</TableHead>
                <TableHead>Bastidor</TableHead>
                <TableHead className="text-right">m²</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead className="text-right">Plan</TableHead>
                <TableHead className="text-right">Real</TableHead>
                <TableHead className="text-right">Pendiente</TableHead>
                <TableHead className="text-right">Desviación</TableHead>
                <TableHead className="text-right">Avance</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.projects.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={COLUMN_COUNT}
                    className="text-center text-sm text-muted-foreground py-6"
                  >
                    No hay proyectos para estos filtros.
                  </TableCell>
                </TableRow>
              ) : (
                view.projects.map((project) => (
                  <Fragment key={project.projectId}>
                    {project.rows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="text-xs">
                          <Link
                            href={`/dashboard/proyectos/${project.projectId}`}
                            className="hover:underline"
                          >
                            {project.projectName}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatShortDate(project.deliveryDate)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.lampName}
                          {row.units > 1 ? (
                            <span className="text-muted-foreground"> ×{row.units}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{row.frameTypeName}</TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.surfaceM2 != null ? row.surfaceM2.toFixed(2) : "—"}
                        </TableCell>
                        <TableCell>
                          <ProcessBadge code={row.process} definition={processStyles.get(row.process)} />
                        </TableCell>
                        <TotalsCells totals={row} />
                        <TableCell className={cn("text-xs", STATUS_CLASS[row.status])}>
                          {GENERAL_VIEW_STATUS_LABELS[row.status]}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/40 font-medium">
                      <TableCell colSpan={6} className="text-xs">
                        Total {project.projectName}
                      </TableCell>
                      <TotalsCells totals={project.totals} />
                      <TableCell />
                    </TableRow>
                  </Fragment>
                ))
              )}
            </TableBody>
            {view.projects.length > 0 ? (
              <TableFooter>
                <TableRow className="font-semibold">
                  <TableCell colSpan={6} className="text-xs">
                    Total general
                  </TableCell>
                  <TotalsCells totals={view.totals} />
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function TotalsCells({ totals }: { totals: GeneralViewTotals }) {
  const deviation = totals.deviationPct;
  return (
    <>
      <TableCell className="text-right font-mono text-xs">{formatHours(totals.planHours)}</TableCell>
      <TableCell className="text-right font-mono text-xs">{formatHours(totals.realHours)}</TableCell>
      <TableCell className="text-right font-mono text-xs">
        {formatHours(totals.pendingHours)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono text-xs",
          deviation != null && deviation > 0 && "text-red-600 dark:text-red-400",
        )}
      >
        {deviation == null ? "—" : `${deviation > 0 ? "+" : ""}${Math.round(deviation)}%`}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{Math.round(totals.progressPct)}%</TableCell>
    </>
  );
}
