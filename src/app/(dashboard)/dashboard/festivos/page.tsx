import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { FestivosClient } from "./festivos-client";

export default async function FestivosPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;

  const y = new Date().getUTCFullYear();
  const rangeStart = new Date(Date.UTC(y, 0, 1));
  const rangeEnd = new Date(Date.UTC(y + 2, 11, 31));

  const holidays = await prisma.holiday.findMany({
    where: {
      AND: [{ startDate: { lte: rangeEnd } }, { endDate: { gte: rangeStart } }],
    },
    orderBy: { startDate: "asc" },
  });

  const rows = holidays.map((h) => ({
    id: h.id,
    startDate: h.startDate.toISOString().slice(0, 10),
    endDate: h.endDate.toISOString().slice(0, 10),
    name: h.name,
    region: h.region,
  }));

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Festivos y calendario laboral"
        description="Días no laborables usados en capacidad, planning y proyección de fin de obra."
      />
      <FestivosClient rows={rows} canManage={canManage} />
    </div>
  );
}
