"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteStockLamp } from "@/features/stock/actions";
import { isHardDeleteEnabled } from "@/lib/hard-delete";
import { getErrorMessage } from "@/lib/error-message";
import { toast } from "sonner";

export function DeleteStockLampButton({
  lampId,
  lampName,
  canHardDelete,
  redirectToList = false,
  variant = "destructive",
  size = "sm",
  className,
}: {
  lampId: string;
  lampName: string;
  canHardDelete: boolean;
  redirectToList?: boolean;
  variant?: "destructive" | "ghost";
  size?: "sm" | "icon";
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const hardDeleteEnabled = isHardDeleteEnabled();

  function onDelete() {
    if (!hardDeleteEnabled) {
      toast.error("La eliminación definitiva está deshabilitada en esta fase.");
      return;
    }
    if (!canHardDelete) {
      toast.error(
        "Hay horas registradas en las tareas de esta lámpara. No se puede eliminar.",
      );
      return;
    }
    if (
      !globalThis.confirm(
        `¿Eliminar definitivamente «${lampName}» del stock? Se borrarán tareas y elementos del lote.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteStockLamp({ lampId });
        toast.success("Lámpara eliminada del stock");
        if (redirectToList) {
          router.push("/dashboard/stock");
        }
        router.refresh();
      } catch (err) {
        toast.error(getErrorMessage(err));
      }
    });
  }

  const disabled = pending || !canHardDelete || !hardDeleteEnabled;
  const title = !hardDeleteEnabled
    ? "Eliminación deshabilitada en esta fase"
    : canHardDelete
      ? "Eliminar del stock"
      : "Hay horas registradas en las tareas";

  if (size === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={className ?? "size-8 text-destructive disabled:opacity-40"}
        disabled={disabled}
        title={title}
        aria-label={`Eliminar lámpara ${lampName} del stock`}
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className ?? "gap-1"}
      disabled={disabled}
      title={title}
      onClick={onDelete}
    >
      <Trash2 className="size-3.5" />
      Eliminar del todo
    </Button>
  );
}
