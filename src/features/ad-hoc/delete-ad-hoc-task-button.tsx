"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteAdHocTask } from "@/features/ad-hoc/actions";
import { handleActionResult } from "@/lib/mutation-error";
import { cn } from "@/lib/utils";

function confirmLabel(notes: string | null | undefined): string {
  const text = notes?.trim();
  if (!text) return "esta imprevista";
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export function DeleteAdHocTaskButton({
  taskId,
  notes,
  hasTimeEntries,
  className,
}: {
  taskId: string;
  notes?: string | null;
  hasTimeEntries: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("size-6 text-destructive hover:text-destructive", className)}
      disabled={pending || hasTimeEntries}
      title={hasTimeEntries ? "Tiene horas fichadas" : "Eliminar imprevista"}
      aria-label="Eliminar imprevista"
      onClick={() => {
        if (!confirm(`¿Eliminar ${confirmLabel(notes)}?`)) return;
        startTransition(async () => {
          const result = await deleteAdHocTask({ taskId });
          const outcome = handleActionResult("ad-hoc.delete", result);
          if (!outcome.success) {
            toast.error(outcome.message);
            return;
          }
          toast.success("Imprevista eliminada");
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-3" />
    </Button>
  );
}
