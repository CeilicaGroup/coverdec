"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Archive, PackageCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteProject,
  toggleProjectActive,
  toggleProjectWarehouse,
} from "@/features/projects/actions";
import {
  EditProjectDialog,
  type EditableProject,
} from "./edit-project-dialog";

function formatActionError(message: string): string {
  if (message.startsWith("ARCHIVE_ONLY:")) {
    return message.replace(/^ARCHIVE_ONLY:\s*/, "").trim();
  }
  return message;
}

export function ProjectRowActions({
  project,
  responsibleOptions = [],
  canHardDelete,
  finished,
}: {
  project: EditableProject & { isActive: boolean; isInWarehouse: boolean };
  responsibleOptions?: Array<{ id: string; name: string; role: string }>;
  canHardDelete: boolean;
  finished: boolean;
}) {
  const { id: projectId, name: projectName, isActive, isInWarehouse } = project;
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

  function onWarehouseToggle() {
    startTransition(async () => {
      const r = await toggleProjectWarehouse({ projectId, isInWarehouse: !isInWarehouse });
      if (!r.ok) {
        toast.error(formatActionError(r.error));
        return;
      }
      toast.success(
        isInWarehouse ? "Proyecto vuelto a producción" : "Proyecto movido a almacén",
      );
      router.refresh();
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
      const r = await deleteProject({ projectId });
      if (!r.ok) {
        toast.error(formatActionError(r.error));
        return;
      }
      toast.success("Proyecto eliminado");
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <EditProjectDialog project={project} responsibleOptions={responsibleOptions} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={isInWarehouse ? "size-8 text-amber-700" : "size-8 text-muted-foreground disabled:opacity-40"}
        disabled={pending || (!finished && !isInWarehouse)}
        onClick={onWarehouseToggle}
        title={
          isInWarehouse
            ? "Volver a producción"
            : finished
              ? "Mover a almacén"
              : "Termina el proyecto para moverlo a almacén"
        }
        aria-label={isInWarehouse ? "Volver a producción" : "Mover a almacén"}
      >
        <PackageCheck className="size-3.5" />
      </Button>
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
