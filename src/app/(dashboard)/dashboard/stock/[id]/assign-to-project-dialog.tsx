"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { assignLampFromStockToProject } from "@/features/stock/actions";
import {
  isOperationCancelled,
  withSimilarLampNameConfirmation,
} from "@/features/projects/lamp-name-client";
import { toast } from "sonner";

export function AssignToProjectDialog({
  lampId,
  lampName,
  projects,
}: {
  lampId: string;
  lampName: string;
  projects: Array<{ id: string; name: string; code: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [projectId, setProjectId] = useState("");
  const [newName, setNewName] = useState(lampName);
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  if (projects.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <PackagePlus className="size-4" />
        Asignar a proyecto
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar «{lampName}» a un proyecto</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!projectId) return;
            startTransition(async () => {
              try {
                await withSimilarLampNameConfirmation("create", async (confirmSimilarName) =>
                  assignLampFromStockToProject({
                    lampId,
                    targetProjectId: projectId,
                    newName: newName.trim() || undefined,
                    confirmSimilarName,
                  }),
                );
                toast.success("Lámpara asignada al proyecto");
                setOpen(false);
                router.push(`/dashboard/proyectos/${projectId}`);
                router.refresh();
              } catch (err) {
                if (isOperationCancelled(err)) return;
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Proyecto destino</Label>
            <Select value={projectId} onValueChange={(value) => setProjectId(value ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona proyecto">
                  {projectId ? (projectNameById.get(projectId) ?? "Proyecto no disponible") : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Nombre en el proyecto (opcional)</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !projectId}>
              Asignar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
