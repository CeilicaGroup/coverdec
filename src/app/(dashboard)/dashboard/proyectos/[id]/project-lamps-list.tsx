"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatHours } from "@/lib/format";

const ProjectLampsListContext = createContext<{ allExpanded: boolean | null }>({
  allExpanded: null,
});

export function ProjectLampsList({
  lampCount,
  children,
}: {
  lampCount: number;
  children: React.ReactNode;
}) {
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null);

  if (lampCount === 0) return <>{children}</>;

  return (
    <ProjectLampsListContext.Provider value={{ allExpanded }}>
      {lampCount > 1 ? (
        <div className="flex justify-end gap-2 px-4 py-2 border-b bg-muted/20">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAllExpanded(true)}
          >
            Expandir todo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setAllExpanded(false)}
          >
            Colapsar todo
          </Button>
        </div>
      ) : null}
      {children}
    </ProjectLampsListContext.Provider>
  );
}

export function ProjectLampSection({
  header,
  actions,
  summary,
  pendingHours,
  defaultExpanded = false,
  children,
}: {
  header: React.ReactNode;
  actions?: ReactNode;
  summary: ReactNode;
  pendingHours: number;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const { allExpanded } = useContext(ProjectLampsListContext);
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    if (allExpanded === true) setExpanded(true);
    if (allExpanded === false) setExpanded(false);
  }, [allExpanded]);

  return (
    <div className="border-b last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 bg-card">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Colapsar lámpara" : "Expandir lámpara"}
        >
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </Button>
        {header}
        {!expanded ? (
          <div className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
            {summary}
          </div>
        ) : null}
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
        ) : null}
        <div className="text-xs font-mono ml-auto shrink-0">
          Pendiente:{" "}
          <span className="font-semibold">{formatHours(pendingHours)}</span>
        </div>
      </div>
      <div className={cn(!expanded && "hidden")}>{children}</div>
    </div>
  );
}
