"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProject, toggleProjectActive } from "@/features/projects/actions";
function formatActionError(message: string): string {
  if (message.startsWith("ARCHIVE_ONLY:")) {
    return message.replace(/^ARCHIVE_ONLY:\s*/, "").trim();
  }
  return message;
}

export function ProjectDangerZone({
  projectId,
  projectName,
  isActive,
  canHardDelete,
}: {
  projectId: string;
  projectName: string;
  isActive: boolean;
  canHardDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onArchiveToggle() {
    startTransition(async () => {
      const r = await toggleProjectActive({ projectId, isActive: !isActive });
      if (!r.ok) {
        toast.error(formatActionError(r.error));
        return;
      }
      toast.success(isActive ? "Proyecto archivado" : "Proyecto reactivado");
      router.refresh();
    });
  }

  function onDelete() {
    const allowHardDelete = process.env.NEXT_PUBLIC_ALLOW_PROJECT_HARD_DELETE !== "false";
    if (!allowHardDelete) {
      toast.error("La eliminación definitiva está deshabilitada. Usa archivar.");
      return;
    }
    if (!canHardDelete) {
      toast.error(
        "Hay partes de trabajo u órdenes vinculadas. Solo puedes archivar el proyecto.",
      );
      return;
    }
    if (
      !globalThis.confirm(
        `¿Eliminar definitivamente «${projectName}»? Se borrarán lámparas y tareas.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const r = await deleteProject({ projectId });
      if (!r.ok) {
        toast.error(formatActionError(r.error));
        return;
      }
      toast.success("Proyecto eliminado");
      router.push("/dashboard/proyectos");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1"
        disabled={pending}
        onClick={onArchiveToggle}
      >
        <Archive className="size-3.5" />
        {isActive ? "Archivar" : "Reactivar"}
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="gap-1"
        disabled={pending || !canHardDelete || process.env.NEXT_PUBLIC_ALLOW_PROJECT_HARD_DELETE === "false"}
        title={
          process.env.NEXT_PUBLIC_ALLOW_PROJECT_HARD_DELETE === "false"
            ? "Eliminación deshabilitada en esta fase"
            : canHardDelete
            ? "Eliminar del todo"
            : "Solo archivar: hay partes u órdenes de producción"
        }
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
        Eliminar del todo
      </Button>
    </div>
  );
}
