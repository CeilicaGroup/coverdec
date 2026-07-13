"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProject } from "@/features/projects/actions";
import { ProjectKind } from "@/generated/prisma";
import { ProjectApprovalStatus } from "@/generated/prisma";
import { PROJECT_KINDS, PROJECT_KIND_LABELS } from "@/lib/project-kind";
import { PROJECT_APPROVAL_STATUS_LABELS } from "@/lib/project-approval";
import { toast } from "sonner";

export function CreateProjectDialog({
  responsibleOptions = [],
}: {
  responsibleOptions?: Array<{ id: string; name: string; role: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [obra, setObra] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [isBillable, setIsBillable] = useState(true);
  const [kind, setKind] = useState<ProjectKind>(ProjectKind.PRODUCCION);
  const [approvalStatus, setApprovalStatus] = useState<ProjectApprovalStatus>(
    ProjectApprovalStatus.PENDING_APPROVAL,
  );
  const [responsibleUserId, setResponsibleUserId] = useState<string | null>(null);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="gap-2" />}>
        <Plus className="size-4" /> Nuevo proyecto
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                const r = await createProject({
                  name,
                  client: client || undefined,
                  obra: obra || undefined,
                  deliveryDate: deliveryDate || undefined,
                  isBillable,
                  kind,
                  approvalStatus,
                  responsibleUserId: responsibleUserId ?? undefined,
                });
                toast.success("Proyecto creado");
                setOpen(false);
                router.refresh();
                router.push(`/dashboard/proyectos/${r.id}`);
              } catch (err) {
                toast.error(reportMutationError("Error", err));
              }
            });
          }}
        >
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Input value={client} onChange={(e) => setClient(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Obra</Label>
              <Input value={obra} onChange={(e) => setObra(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Fecha entrega</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Tipo de proyecto</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind((value ?? ProjectKind.PRODUCCION) as ProjectKind)}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{PROJECT_KIND_LABELS[kind]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PROJECT_KINDS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {PROJECT_KIND_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Estado de aprobación</Label>
            <Select
              value={approvalStatus}
              onValueChange={(value) =>
                setApprovalStatus(
                  (value ?? ProjectApprovalStatus.PENDING_APPROVAL) as ProjectApprovalStatus,
                )
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue>{PROJECT_APPROVAL_STATUS_LABELS[approvalStatus]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.values(ProjectApprovalStatus).map((status) => (
                  <SelectItem key={status} value={status}>
                    {PROJECT_APPROVAL_STATUS_LABELS[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Responsable del proyecto</Label>
            <Select
              value={responsibleUserId}
              onValueChange={(value) => setResponsibleUserId(value === "none" ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Sin responsable">
                  {responsibleUserId
                    ? (responsibleOptions.find((u) => u.id === responsibleUserId)?.name ?? "")
                    : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin responsable</SelectItem>
                {responsibleOptions.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isBillable}
              onCheckedChange={(v) => setIsBillable(v === true)}
            />
            Facturable
          </label>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Crear
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
