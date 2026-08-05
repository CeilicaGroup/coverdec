"use client";

import { CalendarClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PendingAdHocTaskRow } from "@/features/ad-hoc/actions";
import { EditAdHocTaskDialog } from "@/features/ad-hoc/edit-ad-hoc-task-dialog";
import { formatHours } from "@/lib/format";
import type { AdHocFormOptions } from "@/app/(dashboard)/dashboard/_components/ad-hoc-task-form";

export function PendingAdHocTasksPanel({
  tasks,
  processLabels,
  formOptions,
}: {
  tasks: PendingAdHocTaskRow[];
  processLabels: Record<string, string>;
  formOptions: AdHocFormOptions;
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
          Generar planning). Puedes editarlas aquí antes de regenerar. Todos los
          operarios asignados irán en la misma franja horaria.
        </p>
        {tasks.map((task) => (
          <div key={task.id} className="rounded-md border p-3 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{task.projectName}</p>
              <EditAdHocTaskDialog task={task} options={formOptions} />
            </div>
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
