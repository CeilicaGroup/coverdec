import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimerWidget } from "./timer-widget";
import { ManualEntryForm } from "./manual-entry-form";
import { EntriesList } from "./entries-list";
import { filterUnlockedTasks } from "@/features/projects/lamp-tasks";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";

export default async function HorasPage() {
  const ctx = await requireDashboardContext();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));

  const [openTimer, entries, projects, processStyles] = await Promise.all([
    prisma.timeEntry.findFirst({
      where: { userId: ctx.userId, endedAt: null },
      include: { project: true, lamp: true },
    }),
    prisma.timeEntry.findMany({
      where: { userId: ctx.userId, startedAt: { gte: monday } },
      include: { project: true, lamp: true },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    prisma.project.findMany({
      where: { empresaId: ctx.empresaId, isActive: true },
      select: {
        id: true,
        name: true,
        lamps: { select: { id: true, name: true } },
        tasks: {
          where: { pendingHours: { gt: 0 } },
          select: {
            id: true,
            process: true,
            lampId: true,
            order: true,
            pendingHours: true,
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    getProcessBadgeStylesByCode(),
  ]);

  const processLabels = Object.fromEntries(
    [...processStyles.entries()].map(([code, s]) => [code, s.label]),
  );

  const totalWeek = entries.reduce((acc, e) => acc + (e.hours ?? 0), 0);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Mis horas"
        description={`Total semana: ${totalWeek.toFixed(2)}h`}
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Timer en vivo</CardTitle>
          </CardHeader>
          <CardContent>
            <TimerWidget
              openTimer={
                openTimer
                  ? {
                      id: openTimer.id,
                      project: openTimer.project?.name ?? "Sin proyecto",
                      startedAt: openTimer.startedAt.toISOString(),
                    }
                  : null
              }
              projects={projects.map((p) => ({
                id: p.id,
                name: p.name,
                lamps: p.lamps,
                tasks: filterUnlockedTasks(p.tasks),
              }))}
              processLabels={processLabels}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registro manual</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualEntryForm
              projects={projects.map((p) => ({
                id: p.id,
                name: p.name,
                lamps: p.lamps,
                tasks: filterUnlockedTasks(p.tasks),
              }))}
              processLabels={processLabels}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Esta semana</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <EntriesList
            entries={entries.map((e) => ({
              id: e.id,
              project: e.project?.name ?? "—",
              lamp: e.lamp?.name ?? null,
              process: e.process,
              startedAt: e.startedAt.toISOString(),
              endedAt: e.endedAt?.toISOString() ?? null,
              hours: e.hours,
              source: e.source,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
