import { requireDashboardContext } from "@/lib/context";
import { prisma } from "@/lib/db";
import { PageHeader } from "../../_components/page-header";
import { FactoryBoard } from "./factory-board";
import { Card, CardContent } from "@/components/ui/card";
import { FactoryStatus } from "@/generated/prisma";

const STATUS_ORDER: FactoryStatus[] = [
  FactoryStatus.DOSSIER,
  FactoryStatus.PRODUCCION,
  FactoryStatus.CONTROL_CALIDAD,
  FactoryStatus.EMBALAJE,
  FactoryStatus.ENVIADO,
];

const STATUS_LABEL: Record<FactoryStatus, string> = {
  DOSSIER: "Dossier",
  PRODUCCION: "Producción",
  CONTROL_CALIDAD: "Control calidad",
  EMBALAJE: "Embalaje",
  ENVIADO: "Enviado",
};

export default async function FabricaPage() {
  const ctx = await requireDashboardContext();
  const items = await prisma.factoryItem.findMany({
    where: { empresaId: ctx.empresaId },
    orderBy: [{ updatedAt: "desc" }],
    take: 600,
  });

  const grouped = new Map<FactoryStatus, typeof items>();
  for (const status of STATUS_ORDER) grouped.set(status, []);
  for (const item of items) {
    grouped.get(item.status)?.push(item);
  }

  return (
    <div className="p-6 lg:p-8 space-y-6">
      <PageHeader
        title="Módulo fábrica"
        description={`${items.length} items · estado actualizado en tiempo real`}
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATUS_ORDER.map((status) => (
          <Card key={status}>
            <CardContent className="py-3 px-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                {STATUS_LABEL[status]}
              </div>
              <div className="text-2xl font-black mt-1">
                {grouped.get(status)?.length ?? 0}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <FactoryBoard
        items={items.map((i) => ({
          id: i.id,
          product: i.product,
          obra: i.obra,
          nave: i.nave,
          status: i.status,
          code: i.code,
          notes: i.notes,
          scheduledAt: i.scheduledAt?.toISOString() ?? null,
          updatedAt: i.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
