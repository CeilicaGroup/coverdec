import { Role } from "@/generated/prisma";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { PageHeader } from "../../../_components/page-header";
import { PrintTrigger } from "../../ordenes/[id]/print-trigger";
import {
  loadProcessTimeReport,
  loadReportFilterOptions,
} from "@/features/reports/process-time-report";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours, formatShortDate } from "@/lib/format";

interface ReportSearchParams {
  projectId?: string;
  lampId?: string;
  elementTypeId?: string;
  personId?: string;
}

export default async function TiemposProcesosPage({
  searchParams,
}: {
  searchParams?: Promise<ReportSearchParams>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const params = (await searchParams) ?? {};

  const [options, { rows, summary }] = await Promise.all([
    loadReportFilterOptions(params.projectId),
    loadProcessTimeReport(params),
  ]);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Tiempos por proceso"
        description={`${rows.length} tareas con horas registradas · para estimar presupuestos`}
        actions={<PrintTrigger />}
      />

      <form className="no-print flex flex-wrap items-end gap-3" method="get">
        <FilterSelect
          name="projectId"
          label="Proyecto"
          value={params.projectId}
          options={options.projects}
        />
        <FilterSelect
          name="lampId"
          label="Lámpara"
          value={params.lampId}
          options={options.lamps}
          disabled={!params.projectId}
        />
        <FilterSelect
          name="elementTypeId"
          label="Tipo de bastidor"
          value={params.elementTypeId}
          options={options.frameTypes}
        />
        <FilterSelect
          name="personId"
          label="Responsable"
          value={params.personId}
          options={options.persons}
        />
        <button
          type="submit"
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium"
        >
          Filtrar
        </button>
        {params.projectId || params.lampId || params.elementTypeId || params.personId ? (
          <a
            href="/dashboard/informes/tiempos-procesos"
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Limpiar filtros
          </a>
        ) : null}
      </form>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Resumen por bastidor y proceso</CardTitle>
          <p className="text-xs text-muted-foreground">
            Media de horas estimadas vs. reales sobre las tareas filtradas.
          </p>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de bastidor</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead className="text-right">Muestras</TableHead>
                <TableHead className="text-right">Media estimada</TableHead>
                <TableHead className="text-right">Media real</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                    Sin datos para estos filtros.
                  </TableCell>
                </TableRow>
              ) : (
                summary.map((g) => (
                  <TableRow key={`${g.frameTypeName}:${g.process}`}>
                    <TableCell className="text-xs">{g.frameTypeName}</TableCell>
                    <TableCell className="text-xs">{g.processLabel}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{g.sampleCount}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(g.avgEstimatedHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(g.avgRealHours)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Detalle por tarea</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Lámpara</TableHead>
                <TableHead>Bastidor</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">Estimado</TableHead>
                <TableHead className="text-right">Real</TableHead>
                <TableHead className="text-right">Desviación</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-6">
                    Sin tareas con horas registradas para estos filtros.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.taskId}>
                    <TableCell className="text-xs">{row.projectName}</TableCell>
                    <TableCell className="text-xs">{row.lampName}</TableCell>
                    <TableCell className="text-xs">{row.frameTypeName}</TableCell>
                    <TableCell className="text-xs">{row.processLabel}</TableCell>
                    <TableCell className="text-xs">{row.responsableName ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(row.estimatedHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatHours(row.realHours)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.deviationPct == null
                        ? "—"
                        : `${row.deviationPct > 0 ? "+" : ""}${Math.round(row.deviationPct)}%`}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatShortDate(row.completedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FilterSelect({
  name,
  label,
  value,
  options,
  disabled,
}: {
  name: string;
  label: string;
  value: string | undefined;
  options: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        disabled={disabled}
        className="h-9 min-w-[160px] rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
