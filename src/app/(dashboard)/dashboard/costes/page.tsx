import { ShieldCheck } from "lucide-react";
import { requireDashboardContext, requireRole } from "@/lib/context";
import {
  formatWeekRange,
  getMondayOf,
  isoWeek,
  parseWeekParam,
} from "@/lib/week";
import {
  getEmpresaPeople,
  getPlanningForWeek,
} from "@/features/planning/queries";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatEuros, formatHours } from "@/lib/format";

export default async function CostesPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const [planning, people] = await Promise.all([
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
    getEmpresaPeople(),
  ]);

  const byProject = new Map<
    string,
    { name: string; hours: number; cost: number; isBillable: boolean }
  >();
  const byPerson = new Map<
    string,
    { iniciales: string; nombre: string; hours: number; cost: number; hourlyRate: number }
  >();
  let totalCost = 0;
  let billableCost = 0;
  for (const a of planning?.assignments ?? []) {
    const rate = Number(a.person.hourlyRate);
    const lineCost = a.hours * rate;
    totalCost += lineCost;
    if (a.task.project.isBillable) billableCost += lineCost;

    const proj = byProject.get(a.task.projectId) ?? {
      name: a.task.project.name,
      hours: 0,
      cost: 0,
      isBillable: a.task.project.isBillable,
    };
    proj.hours += a.hours;
    proj.cost += lineCost;
    byProject.set(a.task.projectId, proj);

    const person = byPerson.get(a.personId) ?? {
      iniciales: a.person.iniciales,
      nombre: a.person.nombre,
      hours: 0,
      cost: 0,
      hourlyRate: rate,
    };
    person.hours += a.hours;
    person.cost += lineCost;
    byPerson.set(a.personId, person);
  }

  const totalHours = (planning?.assignments ?? []).reduce(
    (acc, a) => acc + a.hours,
    0,
  );
  const billableHours = Array.from(byProject.values())
    .filter((p) => p.isBillable)
    .reduce((acc, p) => acc + p.hours, 0);
  const nonBillableCost = totalCost - billableCost;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Costes · S${week} · ${year}`}
        description={`${formatWeekRange(weekStart)} · Coste según tarifa de cada operario`}
        actions={
          <WeekNav
            weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
            weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
          />
        }
      />

      <div className="rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm flex items-center gap-2 text-yellow-900 dark:text-yellow-200">
        <ShieldCheck className="size-4" />
        Panel privado — solo Jefe de producción y Admin
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Coste semana" value={formatEuros(totalCost)} sub={`${formatHours(totalHours)} totales`} />
        <Kpi
          label="Coste facturable"
          value={formatEuros(billableCost)}
          sub={`${formatHours(billableHours)} en proyectos billables`}
          accent="ok"
        />
        <Kpi
          label="No facturable"
          value={formatEuros(nonBillableCost)}
          sub="Prototipos / interno"
          accent={nonBillableCost > 0 ? "warn" : "muted"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Coste por proyecto</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Horas asignadas</TableHead>
                <TableHead>Coste</TableHead>
                <TableHead>Facturable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from(byProject.entries()).map(([id, value]) => (
                <TableRow key={id}>
                  <TableCell>{value.name}</TableCell>
                  <TableCell className="font-mono">{formatHours(value.hours)}</TableCell>
                  <TableCell className="font-mono">
                    {formatEuros(value.cost)}
                  </TableCell>
                  <TableCell>
                    {value.isBillable ? (
                      <span className="text-emerald-600 font-bold text-xs">
                        ✓ Facturable
                      </span>
                    ) : (
                      <span className="text-red-600 font-bold text-xs">
                        ✗ No facturable
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-bold">Total</TableCell>
                <TableCell className="font-mono font-bold">{formatHours(totalHours)}</TableCell>
                <TableCell className="font-mono font-bold">{formatEuros(totalCost)}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coste por operario</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operario</TableHead>
                <TableHead>Horas normales</TableHead>
                <TableHead>Coste</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const row = byPerson.get(p.id);
                const total = row?.hours ?? 0;
                return (
                  <TableRow key={p.id}>
                    <TableCell>{p.nombre}</TableCell>
                    <TableCell className="font-mono">{formatHours(total)}</TableCell>
                    <TableCell className="font-mono">
                      {formatEuros(row?.cost ?? 0)}
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

function Kpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "ok" | "warn" | "muted";
}) {
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
          {label}
        </div>
        <div
          className={`text-3xl font-black mt-1 ${
            accent === "ok"
              ? "text-emerald-600"
              : accent === "warn"
                ? "text-red-600"
                : "text-foreground"
          }`}
        >
          {value}
        </div>
        <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>
      </CardContent>
    </Card>
  );
}
