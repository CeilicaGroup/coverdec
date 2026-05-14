"use client";

import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FactoryStatus } from "@/generated/prisma";
import { updateFactoryItem } from "@/features/factory/actions";
import { toast } from "sonner";
import { formatShortDate } from "@/lib/format";

interface FactoryItemRow {
  id: string;
  product: string;
  obra: string | null;
  nave: string | null;
  status: FactoryStatus;
  code: string | null;
  notes: string | null;
  scheduledAt: string | null;
  updatedAt: string;
}

const STATUS_COLOR: Record<FactoryStatus, string> = {
  DOSSIER: "bg-gray-100 text-gray-700",
  PRODUCCION: "bg-blue-100 text-blue-700",
  CONTROL_CALIDAD: "bg-yellow-100 text-yellow-700",
  EMBALAJE: "bg-orange-100 text-orange-700",
  ENVIADO: "bg-green-100 text-green-700",
};

export function FactoryBoard({ items }: { items: FactoryItemRow[] }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return items.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        i.product.toLowerCase().includes(q) ||
        i.obra?.toLowerCase().includes(q) ||
        i.code?.toLowerCase().includes(q) ||
        i.nave?.toLowerCase().includes(q)
      );
    });
  }, [items, statusFilter, query]);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 justify-between">
        <CardTitle>Items</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar…"
              className="pl-8 w-64"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "")}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {Object.values(FactoryStatus).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b">
            <tr>
              <th className="text-left py-2 px-2">Código</th>
              <th className="text-left py-2 px-2">Producto</th>
              <th className="text-left py-2 px-2">Obra</th>
              <th className="text-left py-2 px-2">Nave</th>
              <th className="text-left py-2 px-2">Fecha</th>
              <th className="text-left py-2 px-2">Estado</th>
              <th className="text-left py-2 px-2">Notas</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map((item) => (
              <tr key={item.id} className="border-b hover:bg-secondary/40">
                <td className="py-2 px-2 font-mono text-xs">{item.code ?? "—"}</td>
                <td className="py-2 px-2 font-medium">{item.product}</td>
                <td className="py-2 px-2 text-xs">{item.obra ?? "—"}</td>
                <td className="py-2 px-2 text-xs">
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {item.nave ?? "—"}
                  </Badge>
                </td>
                <td className="py-2 px-2 text-xs">{formatShortDate(item.scheduledAt)}</td>
                <td className="py-2 px-2">
                  <Select
                    disabled={pending}
                    value={item.status}
                    onValueChange={(value) => {
                      startTransition(async () => {
                        try {
                          await updateFactoryItem({
                            id: item.id,
                            status: value as FactoryStatus,
                          });
                          toast.success("Estado actualizado");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Error");
                        }
                      });
                    }}
                  >
                    <SelectTrigger
                      className={`h-7 text-[11px] font-bold border-0 px-2 w-36 ${STATUS_COLOR[item.status]}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(FactoryStatus).map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="py-2 px-2 text-[11px] text-muted-foreground max-w-[280px] truncate">
                  {item.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 200 && (
          <div className="text-xs text-muted-foreground mt-3 text-center">
            Mostrando 200 de {filtered.length}. Refina la búsqueda.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
