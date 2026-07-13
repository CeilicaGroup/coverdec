"use client";

import type { ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function noteText(notes: string | null | undefined): string | null {
  const text = notes?.trim();
  return text ? text : null;
}

export function AdHocTaskNotesTooltip({
  notes,
  children,
}: {
  notes: string | null | undefined;
  children: ReactNode;
}) {
  const text = noteText(notes);
  if (!text) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="block w-full cursor-help" aria-label="Ver observación" />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function AdHocTaskNotesIcon({
  notes,
}: {
  notes: string | null | undefined;
}) {
  const text = noteText(notes);
  if (!text) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex cursor-help shrink-0"
              aria-label="Observación"
            />
          }
        >
          <MessageSquare className="size-3 opacity-70" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-wrap">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
