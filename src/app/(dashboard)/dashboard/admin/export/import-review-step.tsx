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
  type BastidorRowDraft,
  type ImportAction,
  type ImportPreviewSummary,
} from "@/features/imports/types";

const ACTION_OPTIONS: { value: ImportAction; label: string }[] = [
  { value: "create", label: "Crear" },
  { value: "update", label: "Actualizar" },
  { value: "skip", label: "Omitir" },
];

interface CatalogOptions {
  processes: { code: string; label: string }[];
  frames: { id: string; name: string; code: string }[];
}

interface ImportReviewStepProps {
  rows: BastidorRowDraft[];
  summary: ImportPreviewSummary;
  catalog: CatalogOptions;
  onEditRow: (rowIndex: number, patch: Partial<BastidorRowDraft>) => void;
}

function statusBadge(status: string) {
  if (status === "ok") return <Badge variant="outline">OK</Badge>;
  if (status === "warning") return <Badge variant="secondary">Aviso</Badge>;
  if (status === "error") return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Omitida</Badge>;
}

export function ImportReviewStep({
  rows,
  summary,
  catalog,
  onEditRow,
}: ImportReviewStepProps) {
  const displayRows = rows
    .filter((r) => r.status !== "skipped")
    .sort(compareImportRowsForReview)
    .slice(0, 200);

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

  return (
    <div className="space-y-3">
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

      <div className="rounded-md border max-h-[420px] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Bastidor</TableHead>
              <TableHead>Proceso</TableHead>
              <TableHead className="w-24">h/m²</TableHead>
              <TableHead>Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center text-muted-foreground py-6"
                >
                  No hay filas para importar con el mapeo actual.
                </TableCell>
              </TableRow>
            ) : (
              displayRows.map((row) => (
                <TableRow key={row.rowIndex}>
                  <TableCell className="font-mono text-xs">{row.rowIndex}</TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs"
                      value={row.frameName}
                      onChange={(e) =>
                        onEditRow(row.rowIndex, { frameName: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {row.issues.some((i) => i.code === "UNKNOWN_PROCESS") ? (
                      <Select
                        value={row.processCode ?? ""}
                        onValueChange={(code) => {
                          const proc = catalog.processes.find((p) => p.code === code);
                          onEditRow(row.rowIndex, {
                            processCode: code ? code : null,
                            processName: proc?.label ?? code ?? "",
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Proceso" />
                        </SelectTrigger>
                        <SelectContent>
                          {catalog.processes.map((p) => (
                            <SelectItem key={p.code} value={p.code}>
                              {p.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        className="h-8 text-xs"
                        value={row.processName}
                        onChange={(e) =>
                          onEditRow(row.rowIndex, { processName: e.target.value })
                        }
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      className="h-8 text-xs font-mono"
                      inputMode="decimal"
                      value={row.hoursPerUnit ?? ""}
                      onChange={(e) =>
                        onEditRow(row.rowIndex, {
                          hoursPerUnit:
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={row.action}
                      onValueChange={(action) =>
                        onEditRow(row.rowIndex, {
                          action: action as ImportAction,
                        })
                      }
                    >
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
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {issueLines.length > 0 && (
        <div className="text-xs text-muted-foreground space-y-1 max-h-24 overflow-auto">
          {issueLines.map(({ rowIndex, issue }) => (
            <p key={`${rowIndex}-${issue.code}`}>
              Fila {rowIndex}: {issue.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
