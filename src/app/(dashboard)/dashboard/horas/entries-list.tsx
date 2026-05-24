"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatHours } from "@/lib/format";
import { ProcessBadge } from "@/components/process-badge";
import { deleteEntry } from "@/features/time-tracking/actions";
import { toast } from "sonner";
import type { ProcessCode } from "@/types/process";

interface EntryRow {
  id: string;
  project: string;
  lamp: string | null;
  process: ProcessCode | null;
  startedAt: string;
  endedAt: string | null;
  hours: number | null;
  source: "TIMER" | "MANUAL";
}

export function EntriesList({ entries }: { entries: EntryRow[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Inicio</TableHead>
          <TableHead>Proyecto</TableHead>
          <TableHead>Proceso</TableHead>
          <TableHead>Origen</TableHead>
          <TableHead className="text-right">Horas</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
              Sin registros esta semana
            </TableCell>
          </TableRow>
        ) : (
          entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-mono text-xs">
                {new Date(e.startedAt).toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </TableCell>
              <TableCell>
                <div className="text-xs font-semibold">{e.project}</div>
                {e.lamp ? (
                  <div className="text-[10px] text-muted-foreground">{e.lamp}</div>
                ) : null}
              </TableCell>
              <TableCell>{e.process ? <ProcessBadge code={e.process} /> : "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {e.source}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatHours(e.hours)}
                {!e.endedAt && (
                  <span className="ml-1 text-[10px] text-red-600">activo</span>
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      try {
                        await deleteEntry({ entryId: e.id });
                        toast.success("Eliminado");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Error");
                      }
                    })
                  }
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
