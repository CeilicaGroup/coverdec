"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createAdHocTask } from "@/features/ad-hoc/actions";
import { IMPREVISTA_PROCESS_CODE } from "@/features/ad-hoc/constants";
import { handleActionResult } from "@/lib/mutation-error";
import { toast } from "sonner";
import {
  AdHocTaskForm,
  type AdHocFormOptions,
  type AdHocTaskFormValues,
} from "./ad-hoc-task-form";

export type { AdHocFormOptions };

export function AdHocTaskDialog({
  options,
}: {
  options: AdHocFormOptions;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(values: AdHocTaskFormValues) {
    if (values.personIds.length === 0 || !values.projectId) return;
    if (!values.employeeNotes.trim() || !values.internalNotes.trim()) return;
    const hours = Number(values.estimatedHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      toast.error("Indica una estimación de horas válida.");
      return;
    }
    startTransition(async () => {
      const result = await createAdHocTask({
        personIds: values.personIds,
        estimatedHours: hours,
        notes: values.employeeNotes.trim(),
        internalNotes: values.internalNotes.trim(),
        projectId: values.projectId,
        naveId: values.naveId || undefined,
        process: values.process || IMPREVISTA_PROCESS_CODE,
      });
      const outcome = handleActionResult("ad-hoc.create", result);
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      toast.success(
        outcome.data.scheduledInPlanning
          ? values.personIds.length === 1
            ? "Imprevista creada y planificada en el borrador actual."
            : `Imprevista creada y planificada para ${values.personIds.length} operarios.`
          : values.personIds.length === 1
            ? "Imprevista creada. Aparecerá al regenerar el planning."
            : `Imprevista creada para ${values.personIds.length} operarios. Aparecerá al regenerar el planning.`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="gap-2" />}>
        <Zap className="size-4" />
        Imprevista
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva tarea imprevista</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Crea la imprevista con operarios y estimación. La planificación en el
          calendario se hace después desde la lista de pendientes.
        </p>
        {open ? (
          <AdHocTaskForm
            key="create"
            options={options}
            submitLabel="Crear imprevista"
            pending={pending}
            onSubmit={handleSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
