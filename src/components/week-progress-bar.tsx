import { cn } from "@/lib/utils";

interface WeekProgressBarProps {
  donePct: number;
  priorPlannedPct?: number;
  weekPlannedPct: number;
  className?: string;
  /** Altura de la barra (tailwind class). */
  barClassName?: string;
}

export function WeekProgressBar({
  donePct,
  priorPlannedPct = 0,
  weekPlannedPct,
  className,
  barClassName = "h-1.5",
}: WeekProgressBarProps) {
  const done = Math.min(100, Math.max(0, donePct));
  const prior = Math.min(100 - done, Math.max(0, priorPlannedPct));
  const week = Math.min(100 - done - prior, Math.max(0, weekPlannedPct));
  const base = done + prior;
  const end = Math.min(100, base + week);

  return (
    <div className={cn("space-y-0.5 min-w-[88px]", className)}>
      <div
        className={cn(
          "flex w-full rounded-full bg-secondary overflow-hidden",
          barClassName,
        )}
      >
        {done > 0 ? (
          <div
            className="h-full bg-emerald-600 dark:bg-emerald-500 shrink-0"
            style={{ width: `${done}%` }}
            title={`Avance real: ${done}%`}
          />
        ) : null}
        {prior > 0 ? (
          <div
            className="h-full bg-sky-500/80 shrink-0"
            style={{ width: `${prior}%` }}
            title={`Planificado en semanas anteriores: ${prior} p.p.`}
          />
        ) : null}
        {week > 0 ? (
          <div
            className="h-full bg-primary shrink-0"
            style={{ width: `${week}%` }}
            title={`Planificado esta semana: +${week} p.p.`}
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
