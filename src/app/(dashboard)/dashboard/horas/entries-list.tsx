"use client";

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDayTimeInZone, formatEntryDuration } from "@/lib/format";
import { ProcessBadge, type ProcessBadgeStyle } from "@/components/process-badge";
import type { ProcessCode } from "@/types/process";
import { TimeEntryInlineActions } from "@/features/time-tracking/time-entry-inline-actions";

interface EntryRow {
  id: string;
  userId: string;
  projectId: string | null;
  lampId: string | null;
  taskId: string | null;
  project: string;
  lamp: string | null;
  process: ProcessCode | null;
  startedAt: string;
  endedAt: string | null;
  hours: number | null;
  notes: string | null;
  source: "TIMER" | "MANUAL";
}

/** Tolerancia para considerar que un registro empieza justo donde acaba el anterior. */
const CONTIGUOUS_MS = 2000;

interface EntryGroup {
  key: string;
  rows: EntryRow[];
}

/**
 * Un reparto («Completar varias») crea un registro por tarea, uno detrás de otro. Se agrupan los
 * contiguos del mismo usuario, proyecto, lámpara, proceso, origen y notas para no listar 260 filas.
 * `entries` llega ordenado del más reciente al más antiguo.
 */
export function groupContiguousEntries(entries: EntryRow[]): EntryGroup[] {
  const groups: EntryGroup[] = [];
  for (const e of entries) {
    const group = groups.at(-1);
    const head = group?.rows.at(-1); // el más antiguo del grupo hasta ahora
    const canJoin =
      group &&
      head &&
      e.endedAt &&
      head.endedAt &&
      e.userId === head.userId &&
      e.projectId === head.projectId &&
      e.lampId === head.lampId &&
      e.process === head.process &&
      e.source === head.source &&
      (e.notes ?? "") === (head.notes ?? "") &&
      Math.abs(new Date(e.endedAt).getTime() - new Date(head.startedAt).getTime()) <= CONTIGUOUS_MS;
    if (canJoin) group.rows.push(e);
    else groups.push({ key: e.id, rows: [e] });
  }
  return groups;
}

export function EntriesList({
  entries,
  canEditAll = false,
  processStyles = {},
}: {
  entries: EntryRow[];
  canEditAll?: boolean;
  /** Nombre y colores de cada proceso por código (para no mostrar CORTE_MANUAL en crudo). */
  processStyles?: Record<string, ProcessBadgeStyle>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupContiguousEntries(entries), [entries]);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
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
          groups.flatMap((group) => {
            if (group.rows.length > 1 && !expanded.has(group.key)) {
              const first = group.rows.at(-1)!;
              const last = group.rows[0]!;
              const total = group.rows.reduce((acc, r) => acc + (r.hours ?? 0), 0);
              return [
                <TableRow key={group.key}>
                  <TableCell className="font-mono text-xs">
                    {formatDayTimeInZone(new Date(first.startedAt))}
                  </TableCell>
                  <TableCell>
                    <div className="text-xs font-semibold">{first.project}</div>
                    {first.lamp ? (
                      <div className="text-[10px] text-muted-foreground">{first.lamp}</div>
                    ) : null}
                    <div className="text-[10px] text-muted-foreground">
                      {group.rows.length} tareas · hasta {formatDayTimeInZone(new Date(last.endedAt!))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {first.process ? <ProcessBadge code={first.process} definition={processStyles[first.process]} /> : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono">
                      {first.source}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatEntryDuration(total)}</TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground"
                      onClick={() => toggle(group.key)}
                    >
                      Ver {group.rows.length}
                    </button>
                  </TableCell>
                </TableRow>,
              ];
            }
            const collapseRow =
              group.rows.length > 1 ? (
                <TableRow key={`${group.key}-collapse`}>
                  <TableCell colSpan={6} className="py-1">
                    <button
                      type="button"
                      className="text-xs underline text-muted-foreground"
                      onClick={() => toggle(group.key)}
                    >
                      Agrupar {group.rows.length} registros
                    </button>
                  </TableCell>
                </TableRow>
              ) : null;
            const rows = group.rows.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="font-mono text-xs">
                {formatDayTimeInZone(new Date(e.startedAt))}
              </TableCell>
              <TableCell>
                <div className="text-xs font-semibold">{e.project}</div>
                {e.lamp ? (
                  <div className="text-[10px] text-muted-foreground">{e.lamp}</div>
                ) : null}
              </TableCell>
              <TableCell>{e.process ? <ProcessBadge code={e.process} definition={processStyles[e.process]} /> : "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {e.source}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-mono">
                {formatEntryDuration(e.hours)}
                {!e.endedAt && (
                  <span className="ml-1 text-[10px] text-red-600">activo</span>
                )}
              </TableCell>
              <TableCell>
                <TimeEntryInlineActions
                  entryId={e.id}
                  userId={e.userId}
                  projectId={e.projectId ?? ""}
                  lampId={e.lampId}
                  taskId={e.taskId}
                  process={e.process}
                  startedAt={e.startedAt}
                  endedAt={e.endedAt}
                  notes={e.notes}
                  canEdit={canEditAll || Boolean(e.endedAt)}
                  canCreate={canEditAll}
                  canDelete
                />
              </TableCell>
            </TableRow>
            ));
            return collapseRow ? [collapseRow, ...rows] : rows;
          })
        )}
      </TableBody>
    </Table>
  );
}
