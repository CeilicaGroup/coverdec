"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Sparkles, CheckCircle2, Undo2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  generatePlanningAction,
  getPlanningHorizonProgressAction,
  prepareHorizonGenerationAction,
  publishPlanningAction,
  undoPlanningAction,
} from "@/features/planning/actions";
import {
  HORIZON_MODE_OPTIONS,
  type HorizonModeKind,
  type PlanningHorizonMode,
} from "@/features/planning/planning-horizon-schema";
import { addWeeks, maxWeeksForMode } from "@/features/planning/planning-horizon";
import type { PlanningStatus, Role } from "@/generated/prisma";

export interface GenerateButtonProject {
  id: string;
  name: string;
  pendingHours: number;
}

function buildHorizonMode(
  kind: HorizonModeKind,
  projectId: string,
  untilIso: string,
): PlanningHorizonMode {
  switch (kind) {
    case "WEEK":
      return { kind: "WEEK" };
    case "MONTH":
      return { kind: "MONTH" };
    case "ALL_PROJECTS":
      return { kind: "ALL_PROJECTS" };
    case "PROJECT":
      return { kind: "PROJECT", projectId };
    case "UNTIL_DATE":
      return { kind: "UNTIL_DATE", untilIso };
  }
}

function weekIsoFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function GenerateButton({
  weekStart,
  planningId,
  planningStatus,
  canUndo,
  hasFuturePlannings,
  hasRegistros,
  isPublished,
  role,
  activeProjects,
}: {
  weekStart: string;
  planningId: string | null;
  planningStatus: PlanningStatus | null;
  canUndo: boolean;
  hasFuturePlannings: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
  role: Role;
  activeProjects: GenerateButtonProject[];
}) {
  const [pending, startTransition] = useTransition();
  const [undoing, startUndoTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  const [horizonKind, setHorizonKind] = useState<HorizonModeKind>("WEEK");
  const [projectId, setProjectId] = useState("");
  const [untilIso, setUntilIso] = useState("");
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [planningWarnings, setPlanningWarnings] = useState<string[]>([]);
  const [unscheduledHours, setUnscheduledHours] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const projectsWithPending = useMemo(
    () => activeProjects.filter((p) => p.pendingHours > 0.25),
    [activeProjects],
  );

  const selectedProjectId =
    projectId || projectsWithPending[0]?.id || "";

  const horizonMode = buildHorizonMode(
    horizonKind,
    selectedProjectId,
    untilIso || weekStart,
  );

  if (role === "OPERARIO") return null;

  const onHorizonKindChange = (value: string | null) => {
    if (!value) return;
    setHorizonKind(value as HorizonModeKind);
  };

  const onGenerate = () => {
    if (horizonKind === "PROJECT" && !selectedProjectId) {
      toast.error("Selecciona un proyecto con horas pendientes");
      return;
    }
    if (horizonKind === "UNTIL_DATE" && !untilIso) {
      toast.error("Indica la fecha límite");
      return;
    }

    startTransition(async () => {
      try {
        await prepareHorizonGenerationAction({ weekStart, horizonMode });

        const maxWeeks = maxWeeksForMode(horizonMode);
        let weeksGenerated = 0;
        let totalAssignments = 0;
        let totalUnscheduled = 0;
        const allWarnings: string[] = [];
        let totalPendingBefore = 0;
        let projectPendingBefore = 0;

        const initialProgress = await getPlanningHorizonProgressAction({
          weekStart,
          horizonMode,
          weeksGenerated: 0,
          totalPendingBeforeHours: 0,
          projectPendingBeforeHours: 0,
        });
        totalPendingBefore = initialProgress.totalPendingHours;
        projectPendingBefore = initialProgress.projectPendingHours;

        while (weeksGenerated < maxWeeks) {
          const currentWeekStart = addWeeks(new Date(weekStart), weeksGenerated);
          const weekIso = weekIsoFromDate(currentWeekStart);
          const weekNum = weeksGenerated + 1;
          setProgressLabel(
            maxWeeks > 1 ? `Generando S${weekNum}${maxWeeks <= 4 ? `/${maxWeeks}` : ""}…` : null,
          );

          const result = await generatePlanningAction({
            weekStart: weekIso,
            horizonMode,
          });

          weeksGenerated += 1;
          totalAssignments += result.assignmentsCount;
          totalUnscheduled += result.unscheduledHours;
          allWarnings.push(...result.warnings);

          const progress = await getPlanningHorizonProgressAction({
            weekStart,
            horizonMode,
            weeksGenerated,
            totalPendingBeforeHours: totalPendingBefore,
            projectPendingBeforeHours: projectPendingBefore,
          });

          totalPendingBefore = progress.totalPendingHours;
          projectPendingBefore = progress.projectPendingHours;

          if (!progress.shouldContinue) {
            break;
          }
        }

        setProgressLabel(null);
        setPlanningWarnings(allWarnings);
        setUnscheduledHours(totalUnscheduled);

        const warningCount = allWarnings.length;
        const weeksLabel =
          weeksGenerated === 1
            ? "1 semana"
            : `${weeksGenerated} semanas`;

        let toastMessage = `Planning generado: ${weeksLabel}, ${totalAssignments} asignaciones`;
        if (horizonKind === "PROJECT" && selectedProjectId) {
          const projectName =
            projectsWithPending.find((p) => p.id === selectedProjectId)?.name ??
            "proyecto";
          toastMessage = `Planning generado para ${projectName}: ${weeksLabel}, ${totalAssignments} asignaciones`;
        }
        if (warningCount > 0) {
          toastMessage += ` (${warningCount} avisos)`;
        }

        toast.success(
          toastMessage,
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
        setProgressLabel(null);
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

  const horizonLabel =
    HORIZON_MODE_OPTIONS.find((o) => o.value === horizonKind)?.label ?? "Alcance";

  return (
    <>
      <Dialog open={warningsOpen} onOpenChange={setWarningsOpen}>
        <DialogContent className="w-full max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Avisos del planning
              {planningWarnings.length > 0 ? ` (${planningWarnings.length})` : ""}
            </DialogTitle>
            <DialogDescription>
              {unscheduledHours > 0
                ? `${unscheduledHours.toFixed(1)}h de trabajo pendiente no cupieron con la capacidad y restricciones actuales (especialidad, cadena de lámpara, registros ya imputados, etc.).`
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
        <Select value={horizonKind} onValueChange={onHorizonKindChange}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <span className="flex-1 truncate text-left">{horizonLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {HORIZON_MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {horizonKind === "PROJECT" && (
          <Select
            value={selectedProjectId}
            onValueChange={(v) => v && setProjectId(v)}
          >
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <span className="flex-1 truncate text-left">
                {projectsWithPending.find((p) => p.id === selectedProjectId)?.name ??
                  "Proyecto"}
              </span>
            </SelectTrigger>
            <SelectContent>
              {projectsWithPending.length === 0 ? (
                <SelectItem value="__none__" disabled>
                  Sin proyectos pendientes
                </SelectItem>
              ) : (
                projectsWithPending.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}

        {horizonKind === "UNTIL_DATE" && (
          <div className="flex items-center gap-1.5">
            <Label htmlFor="horizon-until" className="sr-only">
              Fecha límite
            </Label>
            <Input
              id="horizon-until"
              type="date"
              className="h-8 w-[150px] text-xs"
              min={weekStart.slice(0, 10)}
              value={untilIso}
              onChange={(e) => setUntilIso(e.target.value)}
            />
          </div>
        )}

        <Button onClick={onGenerate} disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {progressLabel ?? (planningId ? "Regenerar" : "Generar planning")}
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
