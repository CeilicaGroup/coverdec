"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Calendar, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

function shortWeekLabel(weekLabel: string): string {
  const match = weekLabel.match(/^S(\d+)/);
  return match ? `S${match[1]}` : weekLabel;
}

function WeekNavInner({
  weekLabel,
  weekIso,
  weekOptions = [],
}: {
  weekLabel: string;
  weekIso: string;
  weekOptions?: Array<{
    weekIso: string;
    weekLabel: string;
    hasPlanning: boolean;
    hasRegistros: boolean;
  }>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const options = weekOptions.length > 0
    ? weekOptions
    : [{ weekIso, weekLabel, hasPlanning: false, hasRegistros: false }];

  const goToWeek = (targetWeekIso: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("week", targetWeekIso);
    router.push(`?${params.toString()}`);
  };

  const navigate = (delta: number) => {
    const current = new Date(weekIso);
    current.setUTCDate(current.getUTCDate() + delta * 7);
    goToWeek(current.toISOString().slice(0, 10));
  };

  const today = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("week");
    const search = params.toString();
    router.push(search ? `?${search}` : "?");
  };

  return (
    <div className="flex items-center gap-1 w-full sm:w-auto">
      <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
        <ChevronLeft className="size-4" />
      </Button>
      <Button
        variant="outline"
        onClick={today}
        className="gap-2 px-2 sm:px-3 flex-1 sm:flex-none min-w-0"
      >
        <Calendar className="size-4 shrink-0" />
        <span className="font-semibold truncate sm:hidden">{shortWeekLabel(weekLabel)}</span>
        <span className="font-semibold truncate hidden sm:inline">{weekLabel}</span>
      </Button>
      <Popover>
        <PopoverTrigger className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground">
          <Calendar className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] p-0">
          <PopoverHeader className="px-3 pt-3 pb-2">
            <PopoverTitle>Semanas</PopoverTitle>
          </PopoverHeader>
          <div className="max-h-72 overflow-y-auto border-t">
            {options.map((option) => {
              const isCurrent = option.weekIso === weekIso;
              return (
                <button
                  key={option.weekIso}
                  type="button"
                  onClick={() => goToWeek(option.weekIso)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{option.weekLabel}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {option.hasPlanning ? (
                        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                          Planning
                        </Badge>
                      ) : null}
                      {option.hasRegistros ? (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          <ClipboardList className="mr-1 size-3" />
                          Registros
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {isCurrent ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
            Etiquetas: planning generado/publicado y semanas con registros.
          </div>
        </PopoverContent>
      </Popover>
      <Button variant="outline" size="icon" onClick={() => navigate(1)}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}

export function WeekNav(props: {
  weekLabel: string;
  weekIso: string;
  weekOptions?: Array<{
    weekIso: string;
    weekLabel: string;
    hasPlanning: boolean;
    hasRegistros: boolean;
  }>;
}) {
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
