"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Archive, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProject, toggleProjectActive } from "@/features/projects/actions";
import {
  EditProjectDialog,
  type EditableProject,
} from "./edit-project-dialog";

function formatActionError(err: unknown): string {
  if (err instanceof Error && err.message.startsWith("ARCHIVE_ONLY:")) {
    return err.message.replace(/^ARCHIVE_ONLY:\s*/, "").trim();
  }
  return err instanceof Error ? err.message : "Error";
}

export function ProjectRowActions({
  project,
  responsibleOptions = [],
  canHardDelete,
}: {
  project: EditableProject & { isActive: boolean };
  responsibleOptions?: Array<{ id: string; name: string; role: string }>;
  canHardDelete: boolean;
}) {
  const { id: projectId, name: projectName, isActive } = project;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onArchiveToggle() {
    startTransition(async () => {
      try {
        await toggleProjectActive({ projectId, isActive: !isActive });
        toast.success(isActive ? "Proyecto archivado" : "Proyecto reactivado");
        router.refresh();
      } catch (e) {
        toast.error(formatActionError(e));
      }
    });
  }

  function onDelete() {
    if (!canHardDelete) {
      toast.error(
        "Hay partes de trabajo u órdenes vinculadas. Solo puedes archivar el proyecto.",
      );
      return;
    }
    if (
      !globalThis.confirm(
        `¿Eliminar definitivamente el proyecto «${projectName}»? Se borrarán lámparas y tareas.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      try {
        await deleteProject({ projectId });
        toast.success("Proyecto eliminado");
        router.refresh();
      } catch (e) {
        toast.error(formatActionError(e));
      }
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <EditProjectDialog project={project} responsibleOptions={responsibleOptions} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-muted-foreground"
        disabled={pending}
        onClick={onArchiveToggle}
        title={isActive ? "Archivar (desactivar)" : "Reactivar"}
        aria-label={isActive ? "Archivar proyecto" : "Reactivar proyecto"}
      >
        <Archive className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 text-destructive disabled:opacity-40"
        disabled={pending || !canHardDelete}
        onClick={onDelete}
        title={
          canHardDelete
            ? "Eliminar del todo"
            : "Solo archivar: hay partes u órdenes de producción"
        }
        aria-label="Eliminar proyecto"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
