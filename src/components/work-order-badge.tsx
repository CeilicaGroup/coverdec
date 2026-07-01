"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { workOrderHighlightHoverHandlers } from "@/features/work-orders/highlight";
import { cn } from "@/lib/utils";
import type { WorkOrderStatus } from "@/generated/prisma";

export interface WorkOrderBadgeProps {
  number: string | null | undefined;
  status?: WorkOrderStatus;
  className?: string;
}

export function WorkOrderBadge({
  number,
  status = "OPEN",
  className,
}: WorkOrderBadgeProps) {
  if (!number) return null;

  const hoverHandlers = workOrderHighlightHoverHandlers(number);

  const badge = (
    <Badge
      variant={status === "CLOSED" ? "secondary" : "outline"}
      className={cn(
        "text-[9px] font-mono px-1.5 py-0 h-4 border-dashed cursor-default",
        className,
      )}
      {...hoverHandlers}
    >
      {number}
    </Badge>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={badge} />
        <TooltipContent side="top" className="text-xs">
          Orden de trabajo {number}
          {status === "CLOSED" ? " (cerrada)" : ""}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkOrderHoverTrigger({
  number,
  className,
  children,
}: {
  number: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={className} {...workOrderHighlightHoverHandlers(number)}>
      {children}
    </span>
  );
}
