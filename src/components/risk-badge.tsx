import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { riskFromDelivery } from "@/lib/format";

type Risk = ReturnType<typeof riskFromDelivery>;

const RISK_MAP: Record<Risk, { label: string; cls: string }> = {
  RIESGO: { label: "Riesgo", cls: "bg-red-100 text-red-800 border-red-300" },
  ATENCION: {
    label: "Atención",
    cls: "bg-yellow-100 text-yellow-800 border-yellow-300",
  },
  OK: { label: "OK", cls: "bg-green-100 text-green-800 border-green-300" },
  SIN_FECHA: { label: "Sin fecha", cls: "bg-muted text-muted-foreground" },
};

export function RiskBadge({
  level,
  className,
}: {
  level: Risk;
  className?: string;
}) {
  const m = RISK_MAP[level];
  return (
    <Badge variant="outline" className={cn(m.cls, "font-bold", className)}>
      {m.label}
    </Badge>
  );
}
