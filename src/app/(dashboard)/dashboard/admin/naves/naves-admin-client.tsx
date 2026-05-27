"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  createNave,
  toggleNaveActive,
  updateNave,
} from "@/features/naves/actions";

interface NaveRow {
  id: string;
  codigo: string;
  nombre: string;
  isActive: boolean;
  personNaves: { person: { user: { id: string; name: string; email: string; role: string } | null } }[];
  tasks: { id: string; lamp: { id: string; name: string } | null }[];
}

export function NavesAdminClient({
  naves,
}: {
  naves: NaveRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [createOpen, setCreateOpen] = useState(false);
  const [editNave, setEditNave] = useState<NaveRow | null>(null);
  const [form, setForm] = useState({ codigo: "", nombre: "" });

  const onCreateSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    startTransition(async () => {
      try {
        await createNave(form);
        toast.success("Nave creada");
        setCreateOpen(false);
        setForm({ codigo: "", nombre: "" });
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  };

  const onEditSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editNave) return;
    startTransition(async () => {
      try {
        await updateNave({ naveId: editNave.id, ...form });
        toast.success("Nave actualizada");
        setEditNave(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  };

  const onToggle = (naveId: string, isActive: boolean) => {
    startTransition(async () => {
      try {
        await toggleNaveActive(naveId, isActive);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  };

  return (
    <div className="space-y-6 mt-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {naves.length} nave{naves.length !== 1 ? "s" : ""} configurada{naves.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={() => { setForm({ codigo: "", nombre: "" }); setCreateOpen(true); }}>
          <Plus className="size-4 mr-1.5" />
          Nueva nave
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {naves.map((nave) => (
          (() => {
            const lamps = Array.from(
              new Map(
                nave.tasks
                  .filter((t) => t.lamp != null)
                  .map((t) => [t.lamp!.id, t.lamp!]),
              ).values(),
            );
            return (
          <Card key={nave.id} className={!nave.isActive ? "opacity-60" : undefined}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Warehouse className="size-4 text-muted-foreground shrink-0" />
                  <CardTitle className="text-base">
                    <span className="font-mono text-sm text-muted-foreground mr-1">{nave.codigo}</span>
                    {nave.nombre}
                  </CardTitle>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2"
                    onClick={() => onToggle(nave.id, !nave.isActive)}
                    disabled={pending}
                  >
                    {nave.isActive ? "Activa" : "Inactiva"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setForm({ codigo: nave.codigo, nombre: nave.nombre });
                      setEditNave(nave);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  Lámparas asignadas ({lamps.length})
                </div>
                {lamps.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Sin lámparas</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {lamps.slice(0, 6).map((lamp) => (
                      <Badge key={lamp.id} variant="secondary" className="text-[10px] font-mono">
                        {lamp.name}
                      </Badge>
                    ))}
                    {lamps.length > 6 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{lamps.length - 6} más
                      </Badge>
                    )}
                  </div>
                )}
              </div>
              <div>
                {(() => {
                  const users = nave.personNaves
                    .map((pn) => pn.person.user)
                    .filter((u): u is NonNullable<typeof u> => u !== null);
                  return (
                    <>
                      <div className="text-xs font-medium text-muted-foreground mb-1.5">
                        Usuarios asignados ({users.length})
                      </div>
                      {users.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Sin usuarios</p>
                ) : (
                  <div className="space-y-0.5">
                        {users.map((u) => (
                      <div key={u.id} className="flex items-center justify-between text-xs">
                        <span className="truncate">{u.name}</span>
                        <Badge variant="outline" className="text-[9px] font-mono shrink-0 ml-1">
                          {u.role}
                        </Badge>
                      </div>
                    ))}
                  </div>
                      )}
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>
            );
          })()
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva nave</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={onCreateSubmit}>
            <div className="space-y-2">
              <Label>Código <span className="text-muted-foreground text-xs">(ej. N1)</span></Label>
              <Input
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                required
                maxLength={20}
                placeholder="N1"
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
                maxLength={100}
                placeholder="Nave 1"
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>Crear</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editNave != null} onOpenChange={(o) => !o && setEditNave(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nave</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={onEditSubmit}>
            <div className="space-y-2">
              <Label>Código</Label>
              <Input
                value={form.codigo}
                onChange={(e) => setForm((f) => ({ ...f, codigo: e.target.value }))}
                required
                maxLength={20}
              />
            </div>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                required
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={pending}>Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
