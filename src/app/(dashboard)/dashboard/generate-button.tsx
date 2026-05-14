"use client";

import { useState, useTransition } from "react";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  generatePlanningAction,
  publishPlanningAction,
} from "@/features/planning/actions";
import type { PlanningStatus, Role } from "@/generated/prisma";

export function GenerateButton({
  weekStart,
  planningId,
  planningStatus,
  role,
}: {
  weekStart: string;
  planningId: string | null;
  planningStatus: PlanningStatus | null;
  role: Role;
}) {
  const [pending, startTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);

  if (role === "OPERARIO") return null;

  const onGenerate = () => {
    startTransition(async () => {
      try {
        const result = await generatePlanningAction({ weekStart });
        toast.success(
          `Planning generado: ${result.assignmentsCount} asignaciones (${result.warnings.length} avisos)`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error generando planning");
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

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
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
      </div>
      <p className="text-[10px] text-muted-foreground max-w-[280px] text-right leading-snug">
        Las horas se comprometen al generar. La semana siguiente solo se puede generar si la anterior
        tiene al menos 40 h planificadas (suma de asignaciones).
      </p>
    </div>
  );
}
