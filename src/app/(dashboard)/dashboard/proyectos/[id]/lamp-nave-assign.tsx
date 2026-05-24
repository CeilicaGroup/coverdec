"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { assignLampToNave } from "@/features/naves/actions";

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

export function LampNaveAssign({
  lampId,
  currentNaveId,
  naves,
}: {
  lampId: string;
  currentNaveId: string | null;
  naves: NaveSummary[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  if (naves.length === 0) return null;

  const currentNave = naves.find((n) => n.id === currentNaveId);

  const onAssign = (value: string | null) => {
    if (!value || value === "none") return;
    startTransition(async () => {
      try {
        await assignLampToNave(lampId, value);
        toast.success(`Tareas asignadas a ${naves.find((n) => n.id === value)?.nombre}`);
        setOpen(false);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  };

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-6 text-[10px] px-2 gap-1"
        onClick={() => setOpen(true)}
        disabled={pending}
      >
        <Warehouse className="size-3" />
        {currentNave ? currentNave.codigo : "Nave"}
      </Button>
    );
  }

  return (
    <Select
      defaultOpen
      value={currentNaveId ?? "none"}
      onValueChange={onAssign}
      onOpenChange={(o) => { if (!o) setOpen(false); }}
    >
      <SelectTrigger className="h-6 text-[10px] w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {naves.map((n) => (
          <SelectItem key={n.id} value={n.id}>
            {n.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
