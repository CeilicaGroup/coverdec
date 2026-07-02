"use client";

import { handleActionResult, reportMutationError } from "@/lib/mutation-error";
import { useEffect, useMemo, useState, useTransition } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  defaultPlanFromDateIso,
  planFromHelpText,
  weekWorkdayIsoRange,
} from "@/features/planning/plan-from";
import { formatWeekRange } from "@/lib/week";
import type { Role } from "@/generated/prisma";

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
  hasPlanning,
  anyDraft,
  canUndo,
  hasFuturePlannings,
  futurePlanningWeeks,
  hasPublishedFuture,
  hasRegistros,
  isPublished,
  role,
  activeProjects,
  disabled = false,
  disabledReason,
}: {
  weekStart: string;
  hasPlanning: boolean;
  anyDraft: boolean;
  canUndo: boolean;
  hasFuturePlannings: boolean;
  futurePlanningWeeks: string[];
  hasPublishedFuture: boolean;
  hasRegistros: boolean;
  isPublished: boolean;
  role: Role;
  activeProjects: GenerateButtonProject[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [undoing, startUndoTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  const [undoDialogOpen, setUndoDialogOpen] = useState(false);
  const [includeFutureWeeks, setIncludeFutureWeeks] = useState(true);
  const [horizonKind, setHorizonKind] = useState<HorizonModeKind>("WEEK");
  const [projectId, setProjectId] = useState("");
  const [untilIso, setUntilIso] = useState("");
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [planningWarnings, setPlanningWarnings] = useState<string[]>([]);
  const [unscheduledHours, setUnscheduledHours] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const workWeek = useMemo(() => weekWorkdayIsoRange(weekStart), [weekStart]);
  const [planFromDate, setPlanFromDate] = useState(() =>
    defaultPlanFromDateIso(weekStart),
  );

  useEffect(() => {
    setPlanFromDate(defaultPlanFromDateIso(weekStart));
  }, [weekStart]);

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
        const prepareOutcome = handleActionResult(
          "planning.prepareHorizonGeneration",
          await prepareHorizonGenerationAction({ weekStart, horizonMode }),
        );
        if (!prepareOutcome.success) {
          toast.error(prepareOutcome.message);
          return;
        }

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

          const generateOutcome = handleActionResult(
            "planning.generatePlanning",
            await generatePlanningAction({
              weekStart: weekIso,
              horizonMode,
              planFromDate: weeksGenerated === 0 ? planFromDate : undefined,
            }),
          );
          if (!generateOutcome.success) {
            toast.error(generateOutcome.message);
            return;
          }
          const result = generateOutcome.data;

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
            lastWeekOutstandingHours: result.unscheduledHours,
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
        toast.error(reportMutationError("Error generando planning", err));
      }
    });
  };

  const onUndoClick = () => {
    setIncludeFutureWeeks(hasFuturePlannings);
    setUndoDialogOpen(true);
  };

  const onConfirmUndo = () => {
    startUndoTransition(async () => {
      try {
        const outcome = handleActionResult(
          "planning.undoPlanning",
          await undoPlanningAction({
            weekStart,
            includeFutureWeeks: hasFuturePlannings ? includeFutureWeeks : false,
          }),
        );
        if (!outcome.success) {
          toast.error(outcome.message);
          return;
        }
        const result = outcome.data;
        setUndoDialogOpen(false);
        toast.success(
          result.deletedCount === 1
            ? "Planning deshecho"
            : `Planning deshecho (${result.deletedCount} semanas)`,
        );
      } catch (err) {
        toast.error(reportMutationError("Error al deshacer planning", err));
      }
    });
  };

  const onPublish = async () => {
    setPublishing(true);
    try {
      const outcome = handleActionResult(
        "planning.publishPlanning",
        await publishPlanningAction({ weekStart }),
      );
      if (!outcome.success) {
        toast.error(outcome.message);
        return;
      }
      const result = outcome.data;
      toast.success(
        result.publishedCount === 1
          ? "Planning publicado"
          : `Planning publicado (${result.publishedCount} naves)`,
      );
    } catch (err) {
      toast.error(reportMutationError("Error publicando planning", err));
    }
    setPublishing(false);
  };

  const undoBlockedReason = (() => {
    if (canUndo) return null;
    if (hasRegistros) {
      return "Hay registros de horas en esta semana o en semanas posteriores. Usa Regenerar para ajustar el plan sin perder registros.";
    }
    return "No se puede deshacer el planning de esta semana.";
  })();

  const futureWeekLabels = futurePlanningWeeks.map((iso) =>
    formatWeekRange(new Date(iso)),
  );

  const undoButton = (
    <Button
      onClick={onUndoClick}
      disabled={!canUndo || undoing || pending}
      variant="outline"
      className="gap-2"
      title={
        undoBlockedReason
          ? undefined
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
  );

  const horizonLabel =
    HORIZON_MODE_OPTIONS.find((o) => o.value === horizonKind)?.label ?? "Alcance";

  return (
    <>
      <Dialog open={undoDialogOpen} onOpenChange={setUndoDialogOpen}>
        <DialogContent className="w-full max-w-md">
          <DialogHeader>
            <DialogTitle>Deshacer planning</DialogTitle>
            <DialogDescription>
              {isPublished
                ? "El planning de esta semana está publicado. Al deshacerlo se eliminará y las horas de las asignaciones volverán a quedar pendientes en las tareas."
                : "Se eliminará el planning de esta semana y las horas asignadas volverán a quedar pendientes en las tareas."}
            </DialogDescription>
          </DialogHeader>

          {hasFuturePlannings && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-3">
              <p className="text-sm">
                Hay {futurePlanningWeeks.length}{" "}
                {futurePlanningWeeks.length === 1 ? "semana posterior" : "semanas posteriores"}{" "}
                con planning:
              </p>
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {futureWeekLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox
                  checked={includeFutureWeeks}
                  onCheckedChange={(checked) => setIncludeFutureWeeks(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  Deshacer también las semanas posteriores
                  {(isPublished || hasPublishedFuture) && (
                    <span className="mt-1 block text-muted-foreground">
                      Incluye plannings publicados si los hay.
                    </span>
                  )}
                </span>
              </label>
              {!includeFutureWeeks && (
                <p className="text-xs text-muted-foreground">
                  No puedes deshacer solo esta semana mientras existan plannings posteriores.
                </p>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setUndoDialogOpen(false)}
              disabled={undoing}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirmUndo}
              disabled={undoing || (hasFuturePlannings && !includeFutureWeeks)}
              className="gap-2"
            >
              {undoing ? <Loader2 className="size-4 animate-spin" /> : null}
              {hasFuturePlannings && includeFutureWeeks
                ? `Deshacer ${futurePlanningWeeks.length + 1} semanas`
                : "Deshacer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

        <div className="flex items-center gap-1.5">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Label
                    htmlFor="plan-from-date"
                    className="cursor-help whitespace-nowrap text-xs text-muted-foreground"
                  />
                }
              >
                Planificar desde
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                {planFromHelpText("DATE")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Input
            id="plan-from-date"
            type="date"
            className="h-8 w-[150px] text-xs"
            min={workWeek.mondayIso}
            max={workWeek.fridayIso}
            value={planFromDate}
            onChange={(e) => setPlanFromDate(e.target.value)}
            aria-label="Planificar desde"
          />
        </div>

        {disabled && disabledReason ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    tabIndex={0}
                    className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <Button onClick={onGenerate} disabled className="gap-2">
                  <Sparkles className="size-4" />
                  {hasPlanning ? "Regenerar" : "Generar planning"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-center">
                {disabledReason}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <Button onClick={onGenerate} disabled={pending} className="gap-2">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {progressLabel ?? (hasPlanning ? "Regenerar" : "Generar planning")}
          </Button>
        )}
        {anyDraft && (
          <Button
            onClick={onPublish}
            disabled={publishing || disabled}
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
        {hasPlanning &&
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
