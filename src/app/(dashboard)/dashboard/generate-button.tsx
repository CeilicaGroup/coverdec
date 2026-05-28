"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, CheckCircle2, Undo2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import {
  generatePlanningAction,
  publishPlanningAction,
  undoPlanningAction,
} from "@/features/planning/actions";
import {
  PLAN_FROM_OPTIONS,
  planFromHelpText,
  planFromLabel,
  type PlanFrom,
} from "@/features/planning/plan-from";
import type { PlanningStatus, Role } from "@/generated/prisma";

export function GenerateButton({
  weekStart,
  planningId,
  planningStatus,
  canUndo,
  hasFuturePlannings,
  hasRegistros,
  isPublished,
  role,
}: {
  weekStart: string;
  planningId: string | null;
  planningStatus: PlanningStatus | null;
  canUndo: boolean;
  hasFuturePlannings: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
  role: Role;
}) {
  const [pending, startTransition] = useTransition();
  const [undoing, startUndoTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  const [planFrom, setPlanFrom] = useState<PlanFrom>("WEEK_START");
  const [planningWarnings, setPlanningWarnings] = useState<string[]>([]);
  const [unscheduledHours, setUnscheduledHours] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const onPlanFromChange = (value: string | null) => {
    if (!value) return;
    setPlanFrom(value as PlanFrom);
  };

  if (role === "OPERARIO") return null;

  const onGenerate = () => {
    startTransition(async () => {
      try {
        const result = await generatePlanningAction({ weekStart, planFrom });
        setPlanningWarnings(result.warnings);
        setUnscheduledHours(result.unscheduledHours);
        const warningCount = result.warnings.length;
        toast.success(
          warningCount > 0
            ? `Planning generado: ${result.assignmentsCount} asignaciones (${warningCount} avisos)`
            : `Planning generado: ${result.assignmentsCount} asignaciones`,
          warningCount > 0
            ? {
                action: {
                  label: "Ver avisos",
                  onClick: () => setWarningsOpen(true),
                },
              }
            : undefined,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error generando planning");
      }
    });
  };

  const onUndo = () => {
    const message = isPublished
      ? "El planning está publicado. ¿Deshacerlo? Se eliminará y las horas de las asignaciones volverán a pendiente en las tareas."
      : "¿Deshacer el planning de esta semana? Se restaurarán las horas pendientes de las tareas.";
    if (!confirm(message)) {
      return;
    }
    startUndoTransition(async () => {
      try {
        await undoPlanningAction({ weekStart });
        toast.success("Planning deshecho");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error al deshacer planning");
      }
    });
  };

  const onPublish = async () => {
    if (!planningId) return;
    setPublishing(true);
    try {
      await publishPlanningAction({ planningId });
      toast.success("Planning publicado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error publicando planning");
    }
    setPublishing(false);
  };

  const planFromHint = planFromHelpText(planFrom);

  const undoBlockedReason = (() => {
    if (canUndo) return null;
    if (hasFuturePlannings) {
      return "Hay plannings de semanas posteriores. Deshaz primero esas semanas para poder deshacer esta.";
    }
    if (hasRegistros) {
      return "Hay registros de horas en esta semana o en semanas posteriores. Usa Regenerar para ajustar el plan sin perder registros.";
    }
    return "No se puede deshacer el planning de esta semana.";
  })();

  const undoButton = (
    <Button
      onClick={onUndo}
      disabled={!canUndo || undoing || pending}
      variant="outline"
      className="gap-2"
      title={undoBlockedReason ? undefined : "Restaura horas pendientes y elimina el planning de esta semana"}
    >
      {undoing ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Undo2 className="size-4" />
      )}
      Deshacer
    </Button>
  );

  return (
    <>
    <Dialog open={warningsOpen} onOpenChange={setWarningsOpen}>
      <DialogContent className="w-full max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Avisos del planning
            {planningWarnings.length > 0
              ? ` (${planningWarnings.length})`
              : ""}
          </DialogTitle>
          <DialogDescription>
            {unscheduledHours > 0
              ? `${unscheduledHours.toFixed(1)}h de trabajo pendiente no cupieron en la semana con la capacidad y restricciones actuales (especialidad, cadena de lámpara, registros ya imputados, «planificar desde», etc.).`
              : "Restricciones detectadas al generar el plan."}
          </DialogDescription>
        </DialogHeader>
        {planningWarnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay avisos.</p>
        ) : (
          <ul className="max-h-[min(60vh,24rem)] list-disc space-y-2 overflow-y-auto pl-5 text-sm">
            {planningWarnings.map((warning, i) => (
              <li key={`${i}-${warning.slice(0, 40)}`} className="leading-snug">
                {warning}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex items-center gap-1">
        <Select value={planFrom} onValueChange={onPlanFromChange}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <span className="flex-1 truncate text-left">
              {planFromLabel(planFrom)}
            </span>
          </SelectTrigger>
          <SelectContent>
            {PLAN_FROM_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          title={planFromHint}
          aria-label={planFromHint}
        >
          <Info className="size-3.5" />
        </Button>
      </div>
      <Button onClick={onGenerate} disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {planningId ? "Regenerar" : "Generar planning"}
        </Button>
        {planningId && planningStatus === "DRAFT" && (
          <Button
            onClick={onPublish}
            disabled={publishing}
            variant="outline"
            className="gap-2"
          >
            {publishing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Publicar
          </Button>
        )}
        {planningId &&
          (undoBlockedReason ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      tabIndex={0}
                      className="inline-flex cursor-not-allowed rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  }
                >
                  {undoButton}
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-center">
                  {undoBlockedReason}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            undoButton
          ))}
    </div>
    </>
  );
}
