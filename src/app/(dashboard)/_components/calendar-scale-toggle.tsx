"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn } from "@/lib/utils";

function CalendarScaleToggleInner({
  scale,
  weekIso,
  monthParam,
  view,
  monthHidden,
}: {
  scale: "week" | "month";
  weekIso?: string;
  monthParam?: string;
  view?: string;
  monthHidden?: boolean;
}) {
  const searchParams = useSearchParams();

  const buildHref = (target: "week" | "month") => {
    const params = new URLSearchParams(searchParams.toString());
    if (view) params.set("view", view);
    else params.delete("view");

    if (target === "week") {
      params.delete("month");
      if (weekIso) params.set("week", weekIso);
    } else {
      params.delete("week");
      if (monthParam) params.set("month", monthParam.slice(0, 7));
    }

    const base = target === "week" ? "/dashboard/semana" : "/dashboard/mes";
    const search = params.toString();
    return search ? `${base}?${search}` : base;
  };

  if (monthHidden) return null;

  return (
    <div
      className="flex items-center rounded-md border bg-secondary/50 p-0.5 text-[10px] font-semibold"
      role="group"
      aria-label="Escala de calendario"
    >
      <Link
        href={buildHref("week")}
        className={cn(
          "rounded px-2.5 py-1 transition-colors",
          scale === "week"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Semana
      </Link>
      <Link
        href={buildHref("month")}
        className={cn(
          "rounded px-2.5 py-1 transition-colors",
          scale === "month"
            ? "bg-card text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Mes
      </Link>
    </div>
  );
}

export function CalendarScaleToggle(props: {
  scale: "week" | "month";
  weekIso?: string;
  monthParam?: string;
  view?: string;
  monthHidden?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className="h-7 w-[120px] rounded-md bg-muted animate-pulse" />
      }
    >
      <CalendarScaleToggleInner {...props} />
    </Suspense>
  );
}
