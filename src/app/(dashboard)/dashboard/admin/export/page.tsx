import { Role } from "@/generated/prisma";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/(dashboard)/_components/page-header";
import { requireDashboardContext, requireRole } from "@/lib/context";

interface ExportPageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

export default async function AdminExportPage({ searchParams }: ExportPageProps) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN]);
  const params = await searchParams;

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Exportaciones"
        description="Descarga un Excel global con 4 hojas: proyectos, tareas, bastidores y registros de horas."
      />
      <section className="rounded-md border bg-card p-4 space-y-4 max-w-2xl">
          <div>
            <h2 className="text-sm font-semibold">Exportar plataforma</h2>
            <p className="text-xs text-muted-foreground mt-1">
              El rango de fechas filtra por fecha de inicio en los registros de horas.
              Si no indicas fechas, se exporta todo el histórico.
            </p>
          </div>
          <form action="/api/admin/export" method="GET" className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Desde</span>
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ""}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Hasta</span>
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ""}
                className="h-8 w-full rounded-md border bg-background px-2 text-sm"
              />
            </label>
            <div className="flex items-end">
              <Button type="submit" className="w-full sm:w-auto">
                Descargar Excel
              </Button>
            </div>
          </form>
      </section>
    </div>
  );
}
