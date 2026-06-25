"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatHours } from "@/lib/format";

export interface NaveKpiRow {
  codigo: string;
  nombre: string;
  weekOps: number;
  weekHours: number;
  inProgress: number;
}

export function OrdersNaveKpis({ rows }: { rows: NaveKpiRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <Card key={row.codigo}>
          <CardContent className="p-4 space-y-1">
            <div className="text-xs font-mono font-bold">{row.codigo}</div>
            <div className="text-[10px] text-muted-foreground truncate">{row.nombre}</div>
            <div className="grid grid-cols-3 gap-2 pt-2 text-xs">
              <div>
                <div className="text-muted-foreground">OPs sem.</div>
                <div className="font-mono font-bold">{row.weekOps}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Horas</div>
                <div className="font-mono font-bold">{formatHours(row.weekHours)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">En curso</div>
                <div className="font-mono font-bold">{row.inProgress}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
