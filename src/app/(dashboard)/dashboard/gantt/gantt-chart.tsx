"use client";

import { useMemo } from "react";
import { RiskBadge } from "@/components/risk-badge";
import { formatDayMonthYear, formatHours, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface GanttProjectRow {
  id: string;
  name: string;
  deliveryDate: string | null;
  expectedCompletion: string | null;
  /** Resto de obra (estimado − hecho), coherente con el resumen. */
  remainingWorkHours: number;
  risk: "RIESGO" | "ATENCION" | "OK" | "SIN_FECHA";
}

export interface GanttMilestone {
  dateKey: string;
  dayLabel: string;
  lines: string[];
}

interface GanttChartProps {
  weekStartIso: string;
  horizonEndIso: string;
  todayIso: string;
  projects: GanttProjectRow[];
  milestones: GanttMilestone[];
}

function parseUtc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

function listBusinessDays(start: Date, end: Date): string[] {
  const keys: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    if (!isWeekend(cursor)) {
      keys.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function dayIndex(keys: string[], iso: string): number {
  const i = keys.indexOf(iso);
  return i >= 0 ? i : -1;
}

export function GanttChart({
  weekStartIso,
  horizonEndIso,
  todayIso,
  projects,
  milestones,
}: GanttChartProps) {
  const axis = useMemo(
    () => listBusinessDays(parseUtc(weekStartIso), parseUtc(horizonEndIso)),
    [weekStartIso, horizonEndIso],
  );

  const total = Math.max(1, axis.length);
  const todayIdx = dayIndex(axis, todayIso);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border overflow-x-auto">
        <div className="min-w-[720px] relative">
          <div
            className="grid border-b bg-muted/40"
            style={{ gridTemplateColumns: `200px repeat(${axis.length}, minmax(48px, 1fr))` }}
          >
            <div className="p-2 text-xs font-semibold">Proyecto</div>
            {axis.map((iso) => (
              <div
                key={iso}
                className="p-2 text-center text-[10px] text-muted-foreground border-l"
              >
                {formatDayMonthYear(parseUtc(iso))}
              </div>
            ))}
          </div>

          {projects.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Sin proyectos pendientes.</p>
          ) : (
            projects.map((p) => {
              const endIso = p.deliveryDate ?? p.expectedCompletion ?? horizonEndIso;
              const startIdx = 0;
              const endIdx = dayIndex(axis, endIso);
              const estIdx = p.expectedCompletion
                ? dayIndex(axis, p.expectedCompletion)
                : -1;
              const delivIdx = p.deliveryDate ? dayIndex(axis, p.deliveryDate) : -1;
              const leftPct = (startIdx / total) * 100;
              const widthPct =
                endIdx >= 0
                  ? ((endIdx - startIdx + 1) / total) * 100
                  : 100;
              const color =
                p.risk === "RIESGO"
                  ? "#B91C1C"
                  : p.risk === "ATENCION"
                    ? "#A16207"
                    : "#15803D";

              return (
                <div
                  key={p.id}
                  className="grid border-t items-center min-h-[52px]"
                  style={{ gridTemplateColumns: `200px repeat(${axis.length}, minmax(48px, 1fr))` }}
                >
                  <div className="p-2 space-y-0.5">
                    <div className="font-semibold text-xs truncate">{p.name}</div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <RiskBadge level={p.risk} />
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatHours(p.remainingWorkHours)}
                      </span>
                    </div>
                  </div>
                  <div
                    className="relative h-8 mx-2"
                    style={{ gridColumn: `2 / span ${axis.length}` }}
                  >
                    {todayIdx >= 0 ? (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-primary z-10"
                        style={{ left: `${((todayIdx + 0.5) / total) * 100}%` }}
                      />
                    ) : null}
                    <div className="absolute inset-0 bg-secondary/50 rounded-full" />
                    <div
                      className="absolute top-1 bottom-1 rounded-full"
                      style={{
                        left: `${leftPct}%`,
                        width: `${Math.min(100 - leftPct, Math.max(2, widthPct))}%`,
                        background: color,
                      }}
                      title={
                        p.deliveryDate
                          ? `Entrega ${formatShortDate(parseUtc(p.deliveryDate))}`
                          : undefined
                      }
                    />
                    {estIdx >= 0 && p.expectedCompletion ? (
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-foreground/50 z-[5]"
                        style={{ left: `${((estIdx + 0.5) / total) * 100}%` }}
                        title={`Fin planif. ${formatShortDate(parseUtc(p.expectedCompletion))}`}
                      />
                    ) : null}
                    {delivIdx >= 0 && p.deliveryDate ? (
                      <div
                        className="absolute top-0 bottom-0 z-20 flex items-center"
                        style={{ left: `${((delivIdx + 1) / total) * 100}%` }}
                        title={`Entrega ${formatShortDate(parseUtc(p.deliveryDate))}`}
                      >
                        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/80" />
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 10 10"
                          className="absolute text-foreground"
                          style={{ transform: "translate(-50%, -50%)", top: "50%" }}
                        >
                          <rect
                            x="1.5"
                            y="1.5"
                            width="7"
                            height="7"
                            transform="rotate(45 5 5)"
                            fill="currentColor"
                          />
                        </svg>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-lg border">
        <div className="px-4 py-3 border-b font-semibold text-sm">Hitos diarios (planning)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-3">
          {milestones.map((m) => (
            <div
              key={m.dateKey}
              className={cn(
                "rounded-md border p-2 text-[10px] leading-relaxed",
                m.lines.length === 0 && "opacity-50",
              )}
            >
              <div className="font-bold mb-1">{m.dayLabel}</div>
              {m.lines.length === 0 ? (
                <span className="text-muted-foreground">Sin asignaciones</span>
              ) : (
                <ul className="space-y-0.5">
                  {m.lines.slice(0, 8).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                  {m.lines.length > 8 ? (
                    <li className="text-muted-foreground">+{m.lines.length - 8} más</li>
                  ) : null}
                </ul>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
