"use client";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  compareImportRowsForReview,
  type HorasRowDraft,
  type ImportAction,
  type ImportPreviewSummary,
  type ProyectoRowDraft,
} from "@/features/imports/types";

const ACTION_OPTIONS: { value: ImportAction; label: string }[] = [
  { value: "create", label: "Crear" },
  { value: "update", label: "Actualizar" },
  { value: "skip", label: "Omitir" },
];

interface ImportProyectosReviewStepProps {
  rows: ProyectoRowDraft[];
  summary: ImportPreviewSummary;
  onEditRow: (rowIndex: number, patch: Partial<ProyectoRowDraft>) => void;
}

function statusBadge(status: string) {
  if (status === "ok") return <Badge variant="outline">OK</Badge>;
  if (status === "warning") return <Badge variant="secondary">Aviso</Badge>;
  if (status === "error") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Omitida</Badge>;
}

export function ImportProyectosReviewStep({
  rows,
  summary,
  onEditRow,
}: ImportProyectosReviewStepProps) {
  const displayRows = rows
    .filter((r) => r.status !== "skipped")
    .sort(compareImportRowsForReview)
    .slice(0, 200);

  return (
    <div className="space-y-3">
      <SummaryBadges summary={summary} />
      <div className="rounded-md border max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Proyecto</TableHead>
              <TableHead>Lámpara</TableHead>
              <TableHead>Proceso</TableHead>
              <TableHead className="w-20">Hr plan</TableHead>
              <TableHead>Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row) => (
              <TableRow key={row.rowIndex}>
                <TableCell className="font-mono text-xs">{row.rowIndex}</TableCell>
                <TableCell>{statusBadge(row.status)}</TableCell>
                <TableCell className="text-xs">{row.projectName}</TableCell>
                <TableCell className="text-xs">{row.lampName}</TableCell>
                <TableCell className="text-xs">{row.processName}</TableCell>
                <TableCell className="font-mono text-xs">{row.hrPlan ?? "—"}</TableCell>
                <TableCell>
                  <ActionSelect
                    value={row.action}
                    onChange={(action) => onEditRow(row.rowIndex, { action })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <IssueList rows={rows} />
    </div>
  );
}

interface ImportHorasReviewStepProps {
  rows: HorasRowDraft[];
  summary: ImportPreviewSummary;
  onEditRow: (rowIndex: number, patch: Partial<HorasRowDraft>) => void;
}

export function ImportHorasReviewStep({
  rows,
  summary,
  onEditRow,
}: ImportHorasReviewStepProps) {
  const displayRows = rows
    .filter((r) => r.status !== "skipped")
    .sort(compareImportRowsForReview)
    .slice(0, 200);

  return (
    <div className="space-y-3">
      <SummaryBadges summary={summary} />
      <div className="rounded-md border max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Operario</TableHead>
              <TableHead>Proyecto</TableHead>
              <TableHead>Proceso</TableHead>
              <TableHead className="w-16">h</TableHead>
              <TableHead>Horario</TableHead>
              <TableHead>Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.map((row) => (
              <TableRow key={row.rowIndex}>
                <TableCell className="font-mono text-xs">{row.rowIndex}</TableCell>
                <TableCell>{statusBadge(row.status)}</TableCell>
                <TableCell className="text-xs">
                  {row.workDate?.toISOString().slice(0, 10) ?? "—"}
                </TableCell>
                <TableCell className="text-xs">{row.operatorName}</TableCell>
                <TableCell className="text-xs">{row.projectName}</TableCell>
                <TableCell className="text-xs">{row.processName}</TableCell>
                <TableCell className="font-mono text-xs">{row.totalHours ?? "—"}</TableCell>
                <TableCell className="text-xs font-mono">
                  {row.startedAt && row.endedAt
                    ? `${row.startedAt.toISOString().slice(11, 16)}–${row.endedAt.toISOString().slice(11, 16)}`
                    : "—"}
                </TableCell>
                <TableCell>
                  <ActionSelect
                    value={row.action}
                    onChange={(action) => onEditRow(row.rowIndex, { action })}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <IssueList rows={rows} />
    </div>
  );
}

function SummaryBadges({ summary }: { summary: ImportPreviewSummary }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <Badge variant="outline">{summary.total} filas</Badge>
      <Badge variant="outline" className="text-green-700">
        {summary.ok} OK
      </Badge>
      <Badge variant="secondary">{summary.warning} avisos</Badge>
      <Badge variant="destructive">{summary.error} errores</Badge>
      <Badge variant="outline">{summary.willCreate} altas</Badge>
      <Badge variant="outline">{summary.willUpdate} actualizaciones</Badge>
      <Badge variant="secondary">{summary.willSkip} omitidas</Badge>
    </div>
  );
}

function ActionSelect({
  value,
  onChange,
}: {
  value: ImportAction;
  onChange: (action: ImportAction) => void;
}) {
  return (
    <Select value={value} onValueChange={(action) => onChange(action as ImportAction)}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ACTION_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function IssueList({
  rows,
}: {
  rows: Array<{ rowIndex: number; issues: { code: string; message: string; severity: string }[] }>;
}) {
  const issueLines = rows
    .flatMap((r) => r.issues.map((issue) => ({ rowIndex: r.rowIndex, issue })))
    .sort((a, b) => {
      const bySeverity =
        (a.issue.severity === "error" ? 0 : 1) -
        (b.issue.severity === "error" ? 0 : 1);
      if (bySeverity !== 0) return bySeverity;
      return a.rowIndex - b.rowIndex;
    })
    .slice(0, 20);

  if (issueLines.length === 0) return null;

  return (
    <div className="text-xs text-muted-foreground space-y-1 max-h-24 overflow-auto">
      {issueLines.map(({ rowIndex, issue }) => (
        <p key={`${rowIndex}-${issue.code}`}>
          Fila {rowIndex}: {issue.message}
        </p>
      ))}
    </div>
  );
}
