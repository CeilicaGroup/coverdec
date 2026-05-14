"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

function WeekNavInner({
  weekLabel,
  weekIso,
}: {
  weekLabel: string;
  weekIso: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const navigate = (delta: number) => {
    const params = new URLSearchParams(searchParams.toString());
    const current = new Date(weekIso);
    current.setUTCDate(current.getUTCDate() + delta * 7);
    params.set("week", current.toISOString().slice(0, 10));
    router.push(`?${params.toString()}`);
  };

  const today = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("week");
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
        <span className="font-semibold">{weekLabel}</span>
      </Button>
      <Button variant="outline" size="icon" onClick={() => navigate(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function WeekNav(props: { weekLabel: string; weekIso: string }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-1 h-8 w-[220px] rounded-md bg-muted animate-pulse" />
      }
    >
      <WeekNavInner {...props} />
    </Suspense>
  );
}
