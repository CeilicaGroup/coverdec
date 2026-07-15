"use client";

import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PendingAdHocTaskRow } from "@/features/ad-hoc/actions";
import { formatHours } from "@/lib/format";

export function PendingAdHocTasksPanel({
  tasks,
  processLabels,
}: {
  tasks: PendingAdHocTaskRow[];
  processLabels: Record<string, string>;
}) {
  if (tasks.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="size-4" />
          Imprevistas sin colocar en el planning ({tasks.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Estas imprevistas se planifican al regenerar el planning (Resumen →
          Generar planning). Todos los operarios asignados irán en la misma
          franja horaria.
        </p>
        {tasks.map((task) => (
          <div key={task.id} className="rounded-md border p-3 space-y-1">
            <p className="text-sm font-medium line-clamp-2">
              {task.notes?.trim() || "Sin descripción"}
            </p>
            <p className="text-xs text-muted-foreground">
              {task.naveLabel} · {processLabels[task.process] ?? task.process} ·{" "}
              {formatHours(task.estimatedHours)}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {task.participants.map((p) => p.label).join(" · ")}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
