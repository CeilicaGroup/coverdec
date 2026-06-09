"use client";

import { handleActionResult } from "@/lib/mutation-error";
import { useTransition } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeTask, uncompleteTask } from "@/features/time-tracking/actions";

export function TaskCompletionAction({
  taskId,
  isCompleted,
  canManage,
}: {
  taskId: string;
  isCompleted: boolean;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();
  if (!canManage) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      className="h-7 text-[11px]"
      onClick={() =>
        startTransition(async () => {
          const result = isCompleted
            ? await uncompleteTask({ taskId })
            : await completeTask({ taskId });
          const outcome = handleActionResult(
            isCompleted ? "task.uncomplete" : "task.complete",
            result,
          );
          if (!outcome.success) {
            toast.error(outcome.message);
            return;
          }
          toast.success(
            isCompleted ? "Tarea marcada como no completada" : "Tarea completada",
          );
        })
      }
    >
      {isCompleted ? <RotateCcw className="mr-1 size-3.5" /> : <CheckCircle2 className="mr-1 size-3.5" />}
      {isCompleted ? "Descompletar" : "Completar"}
    </Button>
  );
}

