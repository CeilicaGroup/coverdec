"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
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
import { toast } from "sonner";
import { createUser, updateUser } from "@/features/admin/users-actions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  person: {
    id: string;
    personNaves: { nave: { id: string; codigo: string; nombre: string } }[];
  } | null;
}

interface NaveOption { id: string; codigo: string; nombre: string }
interface PersonOption { id: string; nombre: string; iniciales: string }

const ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "JEFE_PRODUCCION", label: "Jefe de producción" },
  { value: "OPERARIO", label: "Operario" },
] as const;

type FormState = {
  name: string;
  email: string;
  password: string;
  role: string;
  personId: string;
  naveIds: string[];
};

const emptyForm = (): FormState => ({
  name: "",
  email: "",
  password: "",
  role: "OPERARIO",
  personId: "none",
  naveIds: [],
});

function personSelectLabel(personId: string, people: PersonOption[]): string {
  if (personId === "none") return "Sin persona";
  const person = people.find((p) => p.id === personId);
  return person ? `${person.iniciales} · ${person.nombre}` : "Sin persona";
}

export function UsuariosAdminClient({
  users,
  naves,
  people,
}: {
  users: UserRow[];
  naves: NaveOption[];
  people: PersonOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());

  const openCreate = () => {
    setForm(emptyForm());
    setEditUserId(null);
    setDialogMode("create");
  };

  const openEdit = (u: UserRow) => {
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      personId: u.person?.id ?? "none",
      naveIds: u.person?.personNaves.map((pn) => pn.nave.id) ?? [],
    });
    setEditUserId(u.id);
    setDialogMode("edit");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const personId = form.personId === "none" ? undefined : form.personId;
    startTransition(async () => {
      try {
        if (dialogMode === "create") {
          await createUser({
            name: form.name,
            email: form.email,
            password: form.password,
            role: form.role as "ADMIN" | "JEFE_PRODUCCION" | "OPERARIO",
            personId,
            naveIds: form.naveIds,
          });
          toast.success("Usuario creado");
        } else if (editUserId) {
          await updateUser({
            userId: editUserId,
            role: form.role as "ADMIN" | "JEFE_PRODUCCION" | "OPERARIO",
            personId: form.personId === "none" ? null : form.personId,
            naveIds: form.naveIds,
          });
          toast.success("Usuario actualizado");
        }
        setDialogMode(null);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Error");
      }
    });
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length} usuario{users.length !== 1 ? "s" : ""}</p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-4 mr-1.5" />
          Nuevo usuario
        </Button>
      </div>

      <div className="border rounded-md divide-y">
        {users.map((u) => (
          <div key={u.id} className="flex items-start justify-between px-4 py-3 gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <UserCircle2 className="size-8 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{u.name}</div>
                <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <Badge variant="outline" className="text-[10px] font-mono">{u.role}</Badge>
                  {u.person?.personNaves.map((pn) => (
                    <Badge key={pn.nave.id} variant="secondary" className="text-[10px]">
                      {pn.nave.codigo}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => openEdit(u)}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={dialogMode != null} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogMode === "create" ? "Nuevo usuario" : "Editar usuario"}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                disabled={dialogMode === "edit"}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                required
                disabled={dialogMode === "edit"}
              />
            </div>
            {dialogMode === "create" && (
              <div className="space-y-2">
                <Label>Contraseña <span className="text-muted-foreground text-xs">(mín. 8 caracteres)</span></Label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  minLength={8}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={form.role} onValueChange={(v) => v && setForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Persona vinculada</Label>
              <Select value={form.personId} onValueChange={(v) => v && setForm((f) => ({ ...f, personId: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin persona">
                    {personSelectLabel(form.personId, people)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin persona</SelectItem>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.iniciales} · {p.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {naves.length > 0 && form.role !== "ADMIN" && (
              <div className="space-y-2">
                <Label>Naves</Label>
                <div className="grid grid-cols-2 gap-2 border rounded-md p-3">
                  {naves.map((n) => {
                    const checked = form.naveIds.includes(n.id);
                    return (
                      <label key={n.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              naveIds: e.target.checked
                                ? [...f.naveIds, n.id]
                                : f.naveIds.filter((id) => id !== n.id),
                            }))
                          }
                        />
                        {n.codigo} · {n.nombre}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {dialogMode === "create" ? "Crear" : "Guardar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
