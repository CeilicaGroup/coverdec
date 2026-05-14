"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { createLamp } from "@/features/projects/actions";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export function AddLampForm({
  projectId,
  frameTypes,
}: {
  projectId: string;
  frameTypes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [surfaceM2, setSurfaceM2] = useState("");
  const [units, setUnits] = useState("1");
  const [frameTypeId, setFrameTypeId] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" className="gap-1" />}>
        <Plus className="size-3.5" />
        Lámpara
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Añadir lámpara</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                await createLamp({
                  projectId,
                  name,
                  frameTypeId: frameTypeId || undefined,
                  surfaceM2: surfaceM2 ? Number(surfaceM2) : undefined,
                  units: Number(units) || 1,
                });
                toast.success("Lámpara creada");
                setOpen(false);
                setName("");
                setSurfaceM2("");
                router.refresh();
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
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
              <Label>Medida (m²)</Label>
              <Input
                type="number"
                step={0.01}
                value={surfaceM2}
                onChange={(e) => setSurfaceM2(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Unidades</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tipo de bastidor</Label>
            <Select value={frameTypeId} onValueChange={(v) => setFrameTypeId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="(opcional, genera tareas automáticas)" />
              </SelectTrigger>
              <SelectContent>
                {frameTypes.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              Añadir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
