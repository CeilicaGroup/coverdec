import { prisma } from "@/lib/db";
import { requireDashboardContext } from "@/lib/context";
import { Role, LampElementStockStatus } from "@/generated/prisma";
import { PageHeader } from "../../_components/page-header";
import { StockClient } from "./stock-client";
import { loadTypologyImageAvailability } from "@/features/catalog/typology-images";
import { listStockLamps } from "@/features/stock/actions";
import { getStockPoolProjectId } from "@/features/stock/stock-pool";

export default async function StockPage() {
  const ctx = await requireDashboardContext();
  const canManage = ctx.role === Role.ADMIN || ctx.role === Role.JEFE_PRODUCCION;
  if (!canManage) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sm text-muted-foreground">
          No tienes permisos para gestionar el stock.
        </p>
      </div>
    );
  }

  const [elementTypes, stockLamps, projects, stockPoolProjectId, typologyImages] =
    await Promise.all([
      prisma.elementType.findMany({
        where: { isActive: true },
        include: {
          processes: {
            include: { definition: true },
            orderBy: { sequence: "asc" },
          },
        },
        orderBy: { name: "asc" },
      }),
      listStockLamps(),
      prisma.project.findMany({
        where: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
        select: { id: true, name: true, code: true },
        orderBy: { name: "asc" },
      }),
      getStockPoolProjectId(),
      loadTypologyImageAvailability(),
    ]);

  const assignableLamps = stockLamps.filter(
    (lamp) => lamp.stockStatus === LampElementStockStatus.AVAILABLE,
  );

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Stock"
        description={`${stockLamps.length} lámparas en pool · ${assignableLamps.length} disponibles`}
      />
      <StockClient
        typologyImages={typologyImages}
        elementTypes={elementTypes.map((elementType) => ({
          id: elementType.id,
          name: elementType.name,
          typology: elementType.typology,
          processes: elementType.processes.map((process) => ({
            process: process.process,
            hoursPerUnit: process.hoursPerUnit,
            fixedHours: process.fixedHours,
            sequence: process.sequence,
            label: process.definition.label,
            bgColor: process.definition.bgColor,
            fgColor: process.definition.fgColor,
            borderColor: process.definition.borderColor,
            naveId: process.naveId ?? "",
          })),
        }))}
        stockLamps={stockLamps}
        projects={projects}
        stockPoolProjectId={stockPoolProjectId}
      />
    </div>
  );
}
