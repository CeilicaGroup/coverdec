import { Card, CardContent } from "@/components/ui/card";
import { formatEuros } from "@/lib/format";

export function ProjectCostPanel({
  planMo,
  realMo,
  planMaterial,
  realMaterial,
  ortCost,
}: {
  planMo: number;
  realMo: number;
  planMaterial: number;
  realMaterial: number;
  ortCost: number;
}) {
  const moDev =
    planMo > 0 ? Math.round(((realMo - planMo) / planMo) * 1000) / 10 : null;

  return (
    <Card>
      <CardContent className="py-4 px-5">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Costes plan vs real
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">MO plan</div>
            <div className="font-mono font-bold">{formatEuros(planMo)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">MO real</div>
            <div className="font-mono font-bold">
              {formatEuros(realMo)}
              {moDev != null ? (
                <span className="text-[10px] ml-1 text-muted-foreground">({moDev}%)</span>
              ) : null}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Material plan</div>
            <div className="font-mono font-bold">{formatEuros(planMaterial)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">ORT (aparte)</div>
            <div className="font-mono font-bold text-amber-700">{formatEuros(ortCost)}</div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3">
          Material real = plan (sin integración compras). ORT no suma al coste estándar.
        </p>
      </CardContent>
    </Card>
  );
}
