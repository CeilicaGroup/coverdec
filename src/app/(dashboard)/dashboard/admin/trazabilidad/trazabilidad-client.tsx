"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { AuditLog, AuditOutcome } from "@/generated/prisma";
import type { AuditLogFilters } from "@/features/audit/queries";
import { formatAuditActionLabel, formatAuditCategoryLabel } from "@/lib/audit/categories";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface UserOption {
  id: string;
  name: string;
  email: string;
}

interface TrazabilidadClientProps {
  items: AuditLog[];
  total: number;
  page: number;
  totalPages: number;
  filters: AuditLogFilters;
  users: UserOption[];
  actions: string[];
  entityTypes: string[];
  categories: string[];
}

const ALL = "__all__";

const OUTCOME_LABELS: Record<string, string> = {
  [ALL]: "Todos",
  SUCCESS: "Éxito",
  FAILURE: "Fallo",
};

function outcomeBadge(outcome: AuditOutcome) {
  if (outcome === "SUCCESS") {
    return <Badge variant="secondary">Éxito</Badge>;
  }
  return <Badge variant="destructive">Fallo</Badge>;
}

function formatJson(value: unknown): string {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function TrazabilidadClient({
  items,
  total,
  page,
  totalPages,
  filters,
  users,
  actions,
  entityTypes,
  categories,
}: TrazabilidadClientProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<AuditLog | null>(null);

  const [draft, setDraft] = useState({
    q: filters.q ?? "",
    from: filters.from ?? "",
    to: filters.to ?? "",
    category: filters.category ?? ALL,
    action: filters.action ?? ALL,
    actorUserId: filters.actorUserId ?? ALL,
    outcome: filters.outcome ?? ALL,
    entityType: filters.entityType ?? ALL,
  });

  const applyFilters = (nextPage = 1) => {
    const params = new URLSearchParams();
    if (draft.q.trim()) params.set("q", draft.q.trim());
    if (draft.from) params.set("from", draft.from);
    if (draft.to) params.set("to", draft.to);
    if (draft.category !== ALL) params.set("category", draft.category);
    if (draft.action !== ALL) params.set("action", draft.action);
    if (draft.actorUserId !== ALL) params.set("actorUserId", draft.actorUserId);
    if (draft.outcome !== ALL) params.set("outcome", draft.outcome);
    if (draft.entityType !== ALL) params.set("entityType", draft.entityType);
    if (nextPage > 1) params.set("page", String(nextPage));

    startTransition(() => {
      const query = params.toString();
      router.push(query ? `/dashboard/admin/trazabilidad?${query}` : "/dashboard/admin/trazabilidad");
    });
  };

  const filteredActions = useMemo(() => {
    if (draft.category === ALL) return actions;
    return actions.filter((action) => action.startsWith(`${draft.category}.`));
  }, [actions, draft.category]);

  const selectedUserLabel = useMemo(() => {
    if (draft.actorUserId === ALL) return "Todos";
    const user = users.find((u) => u.id === draft.actorUserId);
    return user ? `${user.name} (${user.email})` : "Todos";
  }, [draft.actorUserId, users]);

  const selectedCategoryLabel =
    draft.category === ALL ? "Todas" : formatAuditCategoryLabel(draft.category);

  const selectedActionLabel =
    draft.action === ALL ? "Todas" : formatAuditActionLabel(draft.action);

  const selectedOutcomeLabel = OUTCOME_LABELS[draft.outcome] ?? "Todos";

  const selectedEntityTypeLabel =
    draft.entityType === ALL ? "Todos" : draft.entityType;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 p-4 border rounded-lg bg-card">
        <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
          <Label htmlFor="audit-q">Buscar</Label>
          <div className="flex gap-2">
            <Input
              id="audit-q"
              placeholder="Resumen, acción, usuario, entidad..."
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters(1);
              }}
            />
            <Button type="button" onClick={() => applyFilters(1)} disabled={pending}>
              <Search className="size-4" />
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-from">Desde</Label>
          <Input
            id="audit-from"
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="audit-to">Hasta</Label>
          <Input
            id="audit-to"
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Categoría</Label>
          <Select
            value={draft.category}
            onValueChange={(value) =>
              setDraft((d) => ({ ...d, category: value ?? ALL, action: ALL }))
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas">{selectedCategoryLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {formatAuditCategoryLabel(category)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Acción</Label>
          <Select
            value={draft.action}
            onValueChange={(value) => setDraft((d) => ({ ...d, action: value ?? ALL }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todas">{selectedActionLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas</SelectItem>
              {filteredActions.map((action) => (
                <SelectItem key={action} value={action}>
                  {formatAuditActionLabel(action)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Usuario</Label>
          <Select
            value={draft.actorUserId}
            onValueChange={(value) => setDraft((d) => ({ ...d, actorUserId: value ?? ALL }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos">{selectedUserLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Resultado</Label>
          <Select
            value={draft.outcome}
            onValueChange={(value) => setDraft((d) => ({ ...d, outcome: value ?? ALL }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos">{selectedOutcomeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              <SelectItem value="SUCCESS">Éxito</SelectItem>
              <SelectItem value="FAILURE">Fallo</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Tipo de entidad</Label>
          <Select
            value={draft.entityType}
            onValueChange={(value) => setDraft((d) => ({ ...d, entityType: value ?? ALL }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Todos">{selectedEntityTypeLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {entityTypes.map((entityType) => (
                <SelectItem key={entityType} value={entityType}>
                  {entityType}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2 md:col-span-2 xl:col-span-4">
          <Button type="button" onClick={() => applyFilters(1)} disabled={pending}>
            Aplicar filtros
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setDraft({
                q: "",
                from: "",
                to: "",
                category: ALL,
                action: ALL,
                actorUserId: ALL,
                outcome: ALL,
                entityType: ALL,
              });
              startTransition(() => router.push("/dashboard/admin/trazabilidad"));
            }}
          >
            Limpiar
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Resumen</TableHead>
              <TableHead>Resultado</TableHead>
              <TableHead>Entidad</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                  No hay eventos con los filtros actuales.
                </TableCell>
              </TableRow>
            ) : (
              items.map((item) => (
                <TableRow
                  key={item.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelected(item)}
                >
                  <TableCell className="whitespace-nowrap text-xs">
                    {format(new Date(item.createdAt), "dd MMM yyyy HH:mm", { locale: es })}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="font-medium">{item.actorName ?? "—"}</div>
                    <div className="text-muted-foreground">{item.actorEmail ?? item.actorUserId ?? "—"}</div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>{formatAuditActionLabel(item.action)}</div>
                    <div className="text-muted-foreground">{formatAuditCategoryLabel(item.category)}</div>
                  </TableCell>
                  <TableCell className="text-xs max-w-[280px] truncate">{item.summary}</TableCell>
                  <TableCell>{outcomeBadge(item.outcome)}</TableCell>
                  <TableCell className="text-xs">
                    {item.entityType ? (
                      <>
                        <div>{item.entityType}</div>
                        <div className="text-muted-foreground truncate max-w-[140px]">
                          {item.entityId ?? "—"}
                        </div>
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Página {page} de {totalPages} · {total.toLocaleString("es-ES")} eventos
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || page <= 1}
            onClick={() => applyFilters(page - 1)}
          >
            <ChevronLeft className="size-4" />
            Anterior
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending || page >= totalPages}
            onClick={() => applyFilters(page + 1)}
          >
            Siguiente
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={selected != null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>Detalle del evento</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <span className="text-muted-foreground">Fecha:</span>{" "}
                    {format(new Date(selected.createdAt), "PPpp", { locale: es })}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Resultado:</span>{" "}
                    {outcomeBadge(selected.outcome)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Usuario:</span>{" "}
                    {selected.actorName ?? "—"} ({selected.actorEmail ?? "—"})
                  </div>
                  <div>
                    <span className="text-muted-foreground">Rol:</span>{" "}
                    {selected.actorRole ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Acción:</span>{" "}
                    {selected.action}
                  </div>
                  <div>
                    <span className="text-muted-foreground">IP:</span>{" "}
                    {selected.ipAddress ?? "—"}
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Resumen</p>
                  <p>{selected.summary}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Metadata</p>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                    {formatJson(selected.metadata)}
                  </pre>
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">Cambios</p>
                  <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto">
                    {formatJson(selected.changes)}
                  </pre>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
