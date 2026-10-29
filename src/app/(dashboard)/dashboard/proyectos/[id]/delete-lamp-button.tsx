"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteLamp } from "@/features/projects/actions";
import { toast } from "sonner";

export function DeleteLampButton({
  lampId,
  lampName,
  disabledReason,
}: {
  lampId: string;
  lampName: string;
  disabledReason?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-destructive shrink-0 disabled:opacity-40"
      disabled={pending || !!disabledReason}
      title={disabledReason ?? undefined}
      aria-label={`Eliminar lámpara ${lampName}`}
      onClick={() => {
        if (
          !confirm(
            `¿Eliminar la lámpara «${lampName}» y todas sus tareas sin horas registradas?`,
          )
        ) {
          return;
        }
        startTransition(async () => {
          const r = await deleteLamp({ lampId });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("Lámpara eliminada");
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-3.5" />
    </Button>
  );
}
