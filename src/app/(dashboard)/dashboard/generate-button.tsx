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
  isPublished,
  role,
}: {
  weekStart: string;
  planningId: string | null;
  planningStatus: PlanningStatus | null;
  canUndo: boolean;
  hasFuturePlannings: boolean;
  isPublished: boolean;
  role: Role;
}) {
  const [pending, startTransition] = useTransition();
  const [undoing, startUndoTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  const [planFrom, setPlanFrom] = useState<PlanFrom>("WEEK_START");

  const onPlanFromChange = (value: string | null) => {
    if (!value) return;
    setPlanFrom(value as PlanFrom);
  };

  if (role === "OPERARIO") return null;

  const onGenerate = () => {
    startTransition(async () => {
      try {
        const result = await generatePlanningAction({ weekStart, planFrom });
        toast.success(
          `Planning generado: ${result.assignmentsCount} asignaciones (${result.warnings.length} avisos)`,
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

  return (
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
        {planningId && (
          <Button
            onClick={onUndo}
            disabled={!canUndo || undoing || pending}
            variant="outline"
            className="gap-2"
            title={
              hasFuturePlannings
                ? "Hay plannings de semanas posteriores; desházalos antes de deshacer esta semana"
                : isPublished
                  ? "Elimina el planning publicado y restaura horas pendientes"
                  : "Restaura horas pendientes y elimina el planning de esta semana"
            }
          >
            {undoing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Undo2 className="size-4" />
            )}
            Deshacer
          </Button>
        )}
    </div>
  );
}
