import type { ProcessCode } from "@/types/process";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import { cn } from "@/lib/utils";

export function DryWaitBadge({
  afterProcess,
  waitHours,
  processDefinition,
  className,
}: {
  afterProcess: ProcessCode;
  waitHours: number;
  processDefinition?: ProcessBadgeStyle | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber-500/60 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
        <span aria-hidden>⏳</span>
        Espera secado ({waitHours}h)
      </span>
      <span className="text-[10px] text-muted-foreground">tras</span>
      <ProcessBadge code={afterProcess} definition={processDefinition} />
    </div>
  );
}
