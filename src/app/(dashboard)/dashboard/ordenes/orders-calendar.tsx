"use client";

import { ProductionOrderStatus } from "@/generated/prisma";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import { getMondayOf, weekDays } from "@/lib/week";
import { cn } from "@/lib/utils";

export interface CalendarOrderBlock {
  id: string;
  number: string;
  process: string | null;
  hours: number | null;
  scheduledAt: string | null;
  status: ProductionOrderStatus;
}

const DAY_START_H = 7;
const DAY_END_H = 19;
const SLOT_H = DAY_END_H - DAY_START_H;

export function OrdersCalendar({ orders }: { orders: CalendarOrderBlock[] }) {
  const weekStart = getMondayOf(new Date());
  const days = weekDays(weekStart);

  const blocksByDay = days.map((day) => {
    const iso = day.toISOString().slice(0, 10);
    return orders.filter((o) => o.scheduledAt?.slice(0, 10) === iso);
  });

  return (
    <div className="overflow-x-auto border rounded-lg">
      <div className="min-w-[720px] grid grid-cols-[56px_repeat(5,minmax(0,1fr))]">
        <div className="border-b bg-muted/40 p-2 text-xs font-medium" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className="border-b border-l bg-muted/40 p-2 text-xs font-medium text-center"
          >
            {day.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
          </div>
        ))}

        <div className="relative border-r">
          {Array.from({ length: SLOT_H + 1 }, (_, i) => DAY_START_H + i).map((h) => (
            <div
              key={h}
              className="h-12 border-b text-[10px] text-muted-foreground px-1 pt-1"
            >
              {h}:00
            </div>
          ))}
        </div>

        {blocksByDay.map((dayOrders, dayIdx) => (
          <div key={dayIdx} className="relative border-l min-h-[calc(12px*48)]">
            {Array.from({ length: SLOT_H + 1 }, (_, i) => (
              <div key={i} className="h-12 border-b border-dashed border-muted/50" />
            ))}
            {dayOrders.map((order) => {
              const startH = order.scheduledAt
                ? new Date(order.scheduledAt).getUTCHours() +
                  new Date(order.scheduledAt).getUTCMinutes() / 60
                : DAY_START_H;
              const clampedStart = Math.max(DAY_START_H, Math.min(DAY_END_H - 0.5, startH));
              const durationH = Math.max(0.5, Math.min(SLOT_H, order.hours ?? 1));
              const top = ((clampedStart - DAY_START_H) / SLOT_H) * 100;
              const height = (durationH / SLOT_H) * 100;
              return (
                <div
                  key={order.id}
                  className={cn(
                    "absolute left-1 right-1 rounded px-1 py-0.5 text-[10px] overflow-hidden",
                    "bg-primary/15 border border-primary/30",
                  )}
                  style={{ top: `${top}%`, height: `${Math.min(height, 100 - top)}%` }}
                  title={`${order.number} · ${formatHours(order.hours)}`}
                >
                  <div className="font-mono font-bold truncate">{order.number}</div>
                  {order.process ? (
                    <ProcessBadge code={order.process} className="scale-90 origin-left" />
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
