import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
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
  getPlanningForWeek,
} from "@/features/planning/queries";
import { PageHeader } from "../../_components/page-header";
import { WeekNav } from "../../_components/week-nav";
import { PersonAvatar } from "@/components/person-avatar";
import { ProcessBadge } from "@/components/process-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rangeLabel } from "@/features/planning/engine/slot-format";
import { formatHours, formatShortDate } from "@/lib/format";
import { PrintToolbar } from "./print-toolbar";

export default async function PersonaPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const ctx = await requireDashboardContext();
  const params = await searchParams;
  const weekStart = parseWeekParam(params.week);
  const { year, week } = isoWeek(weekStart);
  const days = weekDays(weekStart);

  const [planning, allPeople, absences] = await Promise.all([
    getPlanningForWeek({ empresaId: ctx.empresaId, weekStart }),
    getEmpresaPeople(),
    getAbsencesForRange(days[0], days[4]),
  ]);

  const people =
    ctx.role === Role.OPERARIO && ctx.personId
      ? allPeople.filter((p) => p.id === ctx.personId)
      : allPeople;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title={`Planning por persona · S${week} · ${year}`}
        description={
          ctx.role === Role.OPERARIO && ctx.personId
            ? `${formatWeekRange(weekStart)} · Tu semana`
            : `${formatWeekRange(weekStart)} · Equipo completo · imprimir para reparto en nave`
        }
        actions={
          <div className="flex items-center gap-2 no-print">
            <WeekNav
              weekLabel={`S${String(week).padStart(2, "0")} · ${formatWeekRange(weekStart)}`}
              weekIso={getMondayOf(weekStart).toISOString().slice(0, 10)}
            />
            <PrintToolbar />
          </div>
        }
      />

      {!planning && (
        <p className="text-sm text-muted-foreground">
          No hay planning para esta semana. Genera un borrador desde Resumen.
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-4 print:grid-cols-1">
        {people.map((p) => {
          const items = (planning?.assignments ?? [])
            .filter((a) => a.personId === p.id)
            .sort(
              (a, b) =>
                a.date.getTime() - b.date.getTime() || a.startSlot - b.startSlot,
            );
          const total = items.reduce((acc, x) => acc + x.hours, 0);
          const personAbsences = absences.filter((a) => a.personId === p.id);

          return (
            <Card
              key={p.id}
              className="break-inside-avoid print:border print:shadow-none"
            >
              <CardHeader
                className="flex flex-row items-center gap-3 py-3"
                style={{
                  background: p.color,
                  color: "white",
                  borderTopLeftRadius: 10,
                  borderTopRightRadius: 10,
                }}
              >
                <PersonAvatar
                  iniciales={p.iniciales}
                  color={p.color}
                  size={32}
                  className="ring-2 ring-white/70"
                />
                <div className="flex-1">
                  <CardTitle className="text-white text-base">{p.nombre}</CardTitle>
                  <div className="text-[11px] text-white/80">{p.notes ?? ""}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-widest text-white/70">
                    Semana
                  </div>
                  <div className="font-bold text-white">{formatHours(total)}</div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {personAbsences.length > 0 && (
                  <div className="px-3 py-2 text-xs bg-muted border-b">
                    Ausencias:{" "}
                    {personAbsences
                      .map((a) => formatShortDate(a.date))
                      .join(", ")}
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Día</TableHead>
                      <TableHead>Horario</TableHead>
                      <TableHead>Proyecto</TableHead>
                      <TableHead>Proceso</TableHead>
                      <TableHead className="text-right">h</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground py-6"
                        >
                          Sin asignaciones
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-mono text-xs">
                            {formatShortDate(a.date)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {rangeLabel(a.startSlot, a.endSlot)}
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-xs">
                              {a.task.project.name}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                              {a.task.lamp?.name ?? ""}
                            </div>
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
