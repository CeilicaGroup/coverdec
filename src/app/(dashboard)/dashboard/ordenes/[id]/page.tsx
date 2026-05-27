import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { formatHours, formatShortDate } from "@/lib/format";
import { PrintTrigger } from "./print-trigger";

export default async function OrdenDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.productionOrder.findFirst({
    where: { id },
    include: {
      project: true,
    },
  });
  if (!order) notFound();

  return (
    <div className="min-h-screen bg-secondary/30 p-6 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href="/dashboard/ordenes" />}
          >
            <ArrowLeft className="size-4 mr-1" /> Volver
          </Button>
          <PrintTrigger />
        </div>
        <div className="bg-white border rounded-lg p-10 print:border-0 print:rounded-none print:shadow-none">
          <header className="flex items-start justify-between border-b pb-5 mb-6">
            <div>
              <div className="text-3xl font-black tracking-tight">CONTRACT+</div>
              <div className="text-[10px] font-bold tracking-[0.3em] uppercase text-primary mt-1">
                Coverdec Innovación SL
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Coverdec Innovación SL
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-widest text-muted-foreground font-bold">
                Orden de Producción
              </div>
              <div className="font-mono text-2xl font-black mt-1">{order.number}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {formatShortDate(order.createdAt)}
              </div>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Proyecto
              </div>
              <div className="text-base font-bold">{order.project.name}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Cliente / Obra
              </div>
              <div className="text-base">
                {order.project.client ?? order.project.obra ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Lámpara
              </div>
              <div>{order.lampLabel ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Proceso
              </div>
              <div>{order.process ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Horas estimadas
              </div>
              <div className="font-mono">{formatHours(order.hours)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                Programada
              </div>
              <div className="font-mono">{formatShortDate(order.scheduledAt)}</div>
            </div>
          </section>

          {order.notes && (
            <section className="mb-6 border-l-4 border-primary pl-4">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-1">
                Notas
              </div>
              <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
            </section>
          )}

          <section className="grid grid-cols-3 gap-4 pt-6 border-t">
            <SignatureBox label="Operario" />
            <SignatureBox label="Control calidad" />
            <SignatureBox label="Jefe producción" />
          </section>

          <footer className="text-[9px] text-muted-foreground mt-10 text-center">
            Coverdec Innovación SL · CIF B12345678
          </footer>
        </div>
      </div>
    </div>
  );
}

function SignatureBox({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
        {label}
      </div>
      <div className="h-16 border rounded" />
      <div className="text-[10px] text-muted-foreground">Firma / Fecha</div>
    </div>
  );
}

