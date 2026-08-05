"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateAdHocTask, type PendingAdHocTaskRow } from "@/features/ad-hoc/actions";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { handleActionResult } from "@/lib/mutation-error";
import { toast } from "sonner";
import {
  AdHocTaskForm,
  type AdHocFormOptions,
  type AdHocTaskFormValues,
} from "@/app/(dashboard)/dashboard/_components/ad-hoc-task-form";

export function EditAdHocTaskDialog({
  task,
  options,
}: {
  task: PendingAdHocTaskRow;
  options: AdHocFormOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(values: AdHocTaskFormValues) {
    if (!values.employeeNotes.trim() || !values.internalNotes.trim()) return;
    if (!task.hasTimeEntries) {
      if (values.personIds.length === 0 || !values.projectId) return;
      const hours = Number(values.estimatedHours);
      if (!Number.isFinite(hours) || hours <= 0) {
        toast.error("Indica una estimación de horas válida.");
        return;
      }
    }
    startTransition(async () => {
      const hours = Number(values.estimatedHours);
      const result = await updateAdHocTask({
        taskId: task.id,
        personIds: task.hasTimeEntries
          ? task.participants.map((participant) => participant.id)
          : values.personIds,
        estimatedHours: task.hasTimeEntries ? task.estimatedHours : hours,
        notes: values.employeeNotes.trim(),
        internalNotes: values.internalNotes.trim(),
        projectId: task.hasTimeEntries ? task.projectId : values.projectId,
        naveId: task.hasTimeEntries ? task.naveId : values.naveId || undefined,
        process: task.hasTimeEntries
          ? task.process
          : values.process || IMPREVISTA_PROCESS_CODE,
      });
      const outcome = handleActionResult("ad-hoc.update", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success("Imprevista actualizada");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Editar imprevista"
          />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar imprevista</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Solo se pueden editar imprevistas pendientes de colocar en el calendario.
        </p>
        {open ? (
          <AdHocTaskForm
            key={task.id}
            options={options}
            initialValues={{
              projectId: task.projectId,
              employeeNotes: task.notes ?? "",
              internalNotes: task.internalNotes ?? "",
              personIds: task.participants.map((participant) => participant.id),
              estimatedHours: String(task.estimatedHours),
              naveId: task.naveId,
              process: task.process,
            }}
            lockedFields={{ structural: task.hasTimeEntries }}
            submitLabel="Guardar cambios"
            pending={pending}
            onSubmit={handleSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
