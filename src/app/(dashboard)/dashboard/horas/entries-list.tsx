"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDayTimeInZone, formatHours } from "@/lib/format";
import { ProcessBadge } from "@/components/process-badge";
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

export function EntriesList({
  entries,
  canEditAll = false,
}: {
  entries: EntryRow[];
  canEditAll?: boolean;
}) {
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
                {formatDayTimeInZone(new Date(e.startedAt))}
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
          ))
        )}
      </TableBody>
    </Table>
  );
}
