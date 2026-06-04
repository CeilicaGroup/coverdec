import { Role } from "@/generated/prisma";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { PageHeader } from "../../_components/page-header";
import { listCatalogTimeDeviations } from "@/features/time-tracking/catalog-time-stats";
import { getProcessBadgeStylesByCode } from "@/features/planning/queries";
import { DesviacionesTiemposClient } from "./desviaciones-client";

export default async function DesviacionesTiemposPage({
  searchParams,
}: {
  searchParams?: Promise<{ frameTypeId?: string; process?: string }>;
}) {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);
  const params = (await searchParams) ?? {};
  const highlightKey =
    params.frameTypeId && params.process
      ? `${params.frameTypeId}:${params.process}`
      : undefined;

  const [{ policy, rows, alertCount }, processStylesMap] = await Promise.all([
    listCatalogTimeDeviations(),
    getProcessBadgeStylesByCode(),
  ]);
  const processStyles = Object.fromEntries(processStylesMap);

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Desviaciones de tiempos"
        description={`Media móvil de ${policy.movingAverageSamples} tareas (mínimo para alertar) vs catálogo · ${alertCount} alerta${alertCount !== 1 ? "s" : ""}`}
      />
      <DesviacionesTiemposClient
        isAdmin={ctx.role === Role.ADMIN}
        policy={policy}
        rows={rows}
        processStyles={processStyles}
        highlightKey={highlightKey}
      />
    </div>
  );
}
