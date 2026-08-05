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

export function formatAdHocNotesTooltipContent(args: {
  notes?: string | null;
  internalNotes?: string | null;
}): string | null {
  const employee = noteText(args.notes);
  const internal = noteText(args.internalNotes);
  if (!employee && !internal) return null;
  const parts: string[] = [];
  if (employee) parts.push(`Empleado: ${employee}`);
  if (internal) parts.push(`Interno: ${internal}`);
  return parts.join("\n\n");
}

export function AdHocTaskNotesTooltip({
  notes,
  internalNotes,
  children,
}: {
  notes?: string | null;
  internalNotes?: string | null;
  children: ReactNode;
}) {
  const text = formatAdHocNotesTooltipContent({ notes, internalNotes });
  if (!text) return <>{children}</>;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="block w-full cursor-help" aria-label="Ver observaciones" />
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
  internalNotes,
}: {
  notes?: string | null;
  internalNotes?: string | null;
}) {
  const text = formatAdHocNotesTooltipContent({ notes, internalNotes });
  if (!text) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex cursor-help shrink-0"
              aria-label="Observaciones"
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
