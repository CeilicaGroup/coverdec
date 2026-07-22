"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { addExtraTask } from "@/features/projects/actions";
import type { NaveSummary } from "@/features/projects/task-nave";
import { TRANSPORT_PROCESS_CODE } from "@/features/projects/transport-tasks";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function NavePicker({
  value,
  naves,
  onChange,
  disabled,
}: {
  value: string;
  naves: NaveSummary[];
  onChange: (naveId: string) => void;
  disabled?: boolean;
}) {
  const selected = naves.find((n) => n.id === value);
  return (
    <Select
      value={value || null}
      onValueChange={(next) => onChange(next ?? "")}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Nave">
          {selected ? `${selected.codigo} · ${selected.nombre}` : "Nave"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {naves.map((nave) => (
          <SelectItem key={nave.id} value={nave.id}>
            {nave.codigo} · {nave.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Lamp-level extra process (no element). Visible in the lamp header when collapsed. */
export function LampExtraProcessControls({
  lampId,
  lampAvailableProcesses,
  naves,
  canManage,
  className,
}: {
  lampId: string;
  lampAvailableProcesses: string[];
  naves: NaveSummary[];
  canManage: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [process, setProcess] = useState("");
  const [hours, setHours] = useState("");
  const [naveId, setNaveId] = useState("");

  const canAddLamp = canManage && lampAvailableProcesses.length > 0;
  if (!canAddLamp) return null;

  function openDialog() {
    setProcess(lampAvailableProcesses[0] ?? "");
    setHours("");
    setNaveId(naves[0]?.id ?? "");
    setOpen(true);
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7 gap-1 text-xs"
        onClick={openDialog}
        disabled={pending}
      >
        <Plus className="size-3" />
        Extra de lámpara
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extra de lámpara</DialogTitle>
            <DialogDescription>
              Proceso sin elemento, al final de los procesos de esta lámpara.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const h = Number(hours);
              if (!process || !h || h <= 0) {
                toast.error("Completa proceso y horas");
                return;
              }
              if (naves.length > 0 && !naveId) {
                toast.error("Selecciona una nave");
                return;
              }
              startTransition(async () => {
                try {
                  await addExtraTask({
                    lampId,
                    process,
                    estimatedHours: h,
                    ...(naveId ? { naveId } : {}),
                  });
                  toast.success("Proceso añadido");
                  setOpen(false);
                  router.refresh();
                } catch (err) {
                  toast.error(reportMutationError("Error", err));
                }
              });
            }}
          >
            <div className="space-y-2">
              <Label>Proceso</Label>
              <Select value={process} onValueChange={(v) => setProcess(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {lampAvailableProcesses.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p === TRANSPORT_PROCESS_CODE ? "TRANSPORTE" : p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Horas estimadas</Label>
              <Input
                type="number"
                step={0.25}
                min={0.25}
                required
                value={hours}
                onChange={(e) => setHours(e.target.value)}
              />
            </div>
            {naves.length > 0 ? (
              <div className="space-y-2">
                <Label>Nave</Label>
                <NavePicker
                  value={naveId}
                  naves={naves}
                  disabled={pending}
                  onChange={setNaveId}
                />
              </div>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                Añadir
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
