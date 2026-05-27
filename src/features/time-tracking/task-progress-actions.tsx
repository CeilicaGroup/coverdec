"use client";

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
          try {
            if (isCompleted) {
              await uncompleteTask({ taskId });
              toast.success("Tarea marcada como no completada");
            } else {
              await completeTask({ taskId });
              toast.success("Tarea completada");
            }
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Error");
          }
        })
      }
    >
      {isCompleted ? <RotateCcw className="mr-1 size-3.5" /> : <CheckCircle2 className="mr-1 size-3.5" />}
      {isCompleted ? "Descompletar" : "Completar"}
    </Button>
  );
}

