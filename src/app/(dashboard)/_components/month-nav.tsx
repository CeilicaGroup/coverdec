"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { localDateFromCivilIso } from "@/lib/civil-date";

function shiftMonth(monthIso: string, delta: number): string {
  const d = localDateFromCivilIso(monthIso);
  const next = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function MonthNavInner({
  monthLabel,
  monthParam,
}: {
  monthLabel: string;
  monthParam: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const navigate = (delta: number) => {
    const params = new URLSearchParams(searchParams.toString());
    const nextMonth = shiftMonth(monthParam, delta);
    params.set("month", nextMonth.slice(0, 7));
    router.push(`?${params.toString()}`);
  };

  const today = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("month");
    const search = params.toString();
    router.push(search ? `?${search}` : "?");
  };

  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <Button variant="outline" onClick={today} className="gap-2 px-3">
        <Calendar className="size-4" />
        <span className="font-semibold capitalize">{monthLabel}</span>
      </Button>
      <Button variant="outline" size="icon" onClick={() => navigate(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function MonthNav(props: { monthLabel: string; monthParam: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-1 h-8 w-[220px] rounded-md bg-muted animate-pulse" />
      }
    >
      <MonthNavInner {...props} />
    </Suspense>
  );
}
