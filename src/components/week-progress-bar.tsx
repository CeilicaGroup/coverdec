import { cn } from "@/lib/utils";

interface WeekProgressBarProps {
  basePct: number;
  endPct: number;
  className?: string;
  /** Altura de la barra (tailwind class). */
  barClassName?: string;
}

export function WeekProgressBar({
  basePct,
  endPct,
  className,
  barClassName = "h-1.5",
}: WeekProgressBarProps) {
  const base = Math.min(100, Math.max(0, basePct));
  const end = Math.min(100, Math.max(base, endPct));
  const weekPct = Math.max(0, end - base);

  return (
    <div className={cn("space-y-0.5 min-w-[88px]", className)}>
      <div
        className={cn(
          "flex w-full rounded-full bg-secondary overflow-hidden",
          barClassName,
        )}
      >
        {base > 0 ? (
          <div
            className="h-full bg-emerald-600 dark:bg-emerald-500 shrink-0"
            style={{ width: `${base}%` }}
            title={`Avance hasta esta semana: ${base}%`}
          />
        ) : null}
        {weekPct > 0 ? (
          <div
            className="h-full bg-primary shrink-0"
            style={{ width: `${weekPct}%` }}
            title={`Planificado esta semana: +${weekPct} p.p.`}
          />
        ) : null}
      </div>
      <div className="text-[10px] font-mono tabular-nums text-muted-foreground">
        {end > base ? (
          <>
            <span>{base}%</span>
            <span className="mx-0.5">→</span>
            <span className="text-foreground">{end}%</span>
          </>
        ) : (
          <span>{base}%</span>
        )}
      </div>
    </div>
  );
}
