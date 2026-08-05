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
            <p className="text-sm font-medium">{task.projectName}</p>
            {task.notes?.trim() ? (
              <p className="text-sm line-clamp-2">
                <span className="text-muted-foreground">Empleado: </span>
                {task.notes.trim()}
              </p>
            ) : null}
            {task.internalNotes?.trim() ? (
              <p className="text-sm line-clamp-2">
                <span className="text-muted-foreground">Interno: </span>
                {task.internalNotes.trim()}
              </p>
            ) : null}
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
