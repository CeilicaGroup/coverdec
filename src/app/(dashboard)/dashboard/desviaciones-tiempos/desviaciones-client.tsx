"use client";

import { reportMutationError } from "@/lib/mutation-error";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ProcessBadge } from "@/components/process-badge";
import { formatHours } from "@/lib/format";
import { updateTimeDeviationPolicy } from "@/features/time-tracking/deviation-policy-actions";
import type { CatalogTimeDeviationRow } from "@/features/time-tracking/catalog-time-stats";

interface Props {
  isAdmin: boolean;
  policy: {
    deviationThresholdPct: number;
    movingAverageSamples: number;
  };
  rows: CatalogTimeDeviationRow[];
  processStyles: Record<
    string,
    { label: string; bgColor: string; fgColor: string; borderColor: string }
  >;
  highlightKey?: string;
}

export function DesviacionesTiemposClient({
  isAdmin,
  policy,
  rows,
  processStyles,
  highlightKey,
}: Props) {
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    if (!highlightKey || !highlightRowRef.current) return;
    highlightRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightKey]);
  const [pending, startTransition] = useTransition();
  const [thresholdPct, setThresholdPct] = useState(String(policy.deviationThresholdPct));
  const [windowSamples, setWindowSamples] = useState(String(policy.movingAverageSamples));

  const onSavePolicy = () => {
    const deviationThresholdPct = Number(thresholdPct);
    const movingAverageSamples = Number(windowSamples);
    if (
      Number.isNaN(deviationThresholdPct) ||
      Number.isNaN(movingAverageSamples) ||
      deviationThresholdPct < 1 ||
      movingAverageSamples < 1
    ) {
      toast.error("Revisa los valores de umbral y ventana.");
      return;
    }
    startTransition(async () => {
      try {
        await updateTimeDeviationPolicy({
          deviationThresholdPct,
          movingAverageSamples,
        });
        toast.success("Política actualizada");
      } catch (err) {
        toast.error(reportMutationError("No se pudo guardar", err));
      }
    });
  };

  const alertRows = rows.filter((r) => r.isAlert);

  return (
    <div className="space-y-6">
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Umbral de desviación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="threshold">Desviación máxima (%)</Label>
                <Input
                  id="threshold"
                  type="number"
                  min={1}
                  max={200}
                  className="w-28"
                  value={thresholdPct}
                  onChange={(e) => setThresholdPct(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="window">Ventana (N muestras)</Label>
                <Input
                  id="window"
                  type="number"
                  min={1}
                  max={500}
                  className="w-28"
                  value={windowSamples}
                  onChange={(e) => setWindowSamples(e.target.value)}
                />
              </div>
              <Button type="button" disabled={pending} onClick={onSavePolicy}>
                Guardar
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              La ventana define la media móvil y el mínimo de tareas completadas para poder alertar.
            </p>
          </CardContent>
        </Card>
      )}

      {alertRows.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4">
            <p className="text-sm font-medium">
              {alertRows.length} desviación{alertRows.length !== 1 ? "es" : ""} activa
              {alertRows.length !== 1 ? "s" : ""} respecto al catálogo
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bastidor</TableHead>
                <TableHead>Proceso</TableHead>
                <TableHead className="text-right">Catálogo</TableHead>
                <TableHead className="text-right">Media observada</TableHead>
                <TableHead className="text-right">Desviación</TableHead>
                <TableHead className="text-right">Muestras (N)</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const style = processStyles[row.process];
                const rowKey = `${row.elementTypeId}:${row.process}`;
                const isHighlighted = highlightKey === rowKey;
                return (
                  <TableRow
                    key={rowKey}
                    ref={isHighlighted ? highlightRowRef : undefined}
                    className={isHighlighted ? "bg-amber-500/10 ring-1 ring-amber-500/50" : undefined}
                  >
                    <TableCell>
                      <div className="font-medium text-sm">{row.frameTypeName}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {row.frameTypeCode}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ProcessBadge code={row.process} definition={style ?? null} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatHours(row.catalogHoursPerUnit)}/m²
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.observedHoursPerUnit != null
                        ? `${formatHours(row.observedHoursPerUnit)}/m²`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.deviationPct != null ? `${row.deviationPct.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm font-mono">
                      {row.sampleCount}/{row.movingAverageSamples}
                      {row.totalSamples > row.sampleCount ? (
                        <span className="text-muted-foreground text-[10px] block">
                          de {row.totalSamples} tot.
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.isAlert ? (
                        <Badge variant="destructive">Alerta</Badge>
                      ) : (
                        <Badge variant="secondary">OK</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href="/dashboard/catalogo"
                        className="text-sm text-primary hover:underline"
                      >
                        Catálogo
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
