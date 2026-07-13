"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ProjectNextProcessCell({
  processes,
  finished,
  hasTasks,
}: {
  processes: string[];
  finished: boolean;
  hasTasks: boolean;
}) {
  if (finished) {
    return <span className="text-xs text-muted-foreground">Completado</span>;
  }

  if (!hasTasks) {
    return <span className="text-xs text-muted-foreground">Sin tareas</span>;
  }

  if (processes.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const first = processes[0]!;
  if (processes.length === 1) {
    return <span className="text-xs text-muted-foreground">{first}</span>;
  }

  const trigger = (
    <span className="text-xs text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
      {first} (+{processes.length - 1})
    </span>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={trigger} />
        <TooltipContent side="top" className="max-w-xs">
          <p className="font-medium mb-1.5">Procesos pendientes</p>
          <ol className="list-decimal list-inside space-y-0.5">
            {processes.map((process, index) => (
              <li key={`${process}-${index}`}>{process}</li>
            ))}
          </ol>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
