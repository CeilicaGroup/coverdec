"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  applyImportPreview,
  buildImportPreview,
  getImportCatalogOptions,
  getSheetColumnsForMapping,
  inspectImportFile,
} from "@/features/imports/actions";
import {
  countBlockingImportErrors,
  type BastidorRowDraft,
  type ImportApplyResult,
  type ImportMapping,
  type ImportPreviewSummary,
  type SheetColumnOption,
} from "@/features/imports/types";
import { ImportMappingStep } from "./import-mapping-step";
import { ImportReviewStep } from "./import-review-step";
import { ImportFinalStep } from "./import-final-step";

type WizardStep = "upload" | "mapping" | "review" | "done";

const STEP_LABELS: Record<WizardStep, string> = {
  upload: "1. Archivo",
  mapping: "2. Mapeo",
  review: "3. Revisión",
  done: "4. Completado",
};

export function ImportWizard() {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<WizardStep>("upload");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [columnOptions, setColumnOptions] = useState<SheetColumnOption[]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [rows, setRows] = useState<BastidorRowDraft[]>([]);
  const [summary, setSummary] = useState<ImportPreviewSummary | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null);
  const [catalog, setCatalog] = useState<{
    processes: { code: string; label: string }[];
    frames: { id: string; name: string; code: string }[];
  }>({ processes: [], frames: [] });
  const [rowEdits, setRowEdits] = useState<
    Array<{ rowIndex: number; patch: Record<string, unknown> }>
  >([]);

  const reset = useCallback(() => {
    setStep("upload");
    setSessionId(null);
    setSheetNames([]);
    setColumnOptions([]);
    setMapping(null);
    setRows([]);
    setSummary(null);
    setApplyResult(null);
    setRowEdits([]);
  }, []);

  useEffect(() => {
    getImportCatalogOptions()
      .then(setCatalog)
      .catch(() => undefined);
  }, []);

  async function refreshColumnOptions(
    sid: string,
    map: ImportMapping,
  ): Promise<SheetColumnOption[]> {
    const options = await getSheetColumnsForMapping({
      sessionId: sid,
      sheetName: map.sheetName,
    });
    setColumnOptions(options);
    return options;
  }

  function handleUpload(file: File) {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        const inspected = await inspectImportFile(fd);
        setSessionId(inspected.sessionId);
        setSheetNames(inspected.sheetNames);
        setMapping(inspected.suggestedMapping);
        setColumnOptions(inspected.columnOptions);
        setStep("mapping");
        toast.success(
          `Archivo cargado (${inspected.sampleRowCount} filas detectadas con preset legacy)`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al leer el archivo");
      }
    });
  }

  function runPreview() {
    if (!sessionId || !mapping) return;
    startTransition(async () => {
      try {
        const preview = await buildImportPreview({
          sessionId,
          mapping,
          rowEdits: rowEdits.length ? rowEdits : undefined,
        });
        setRows(preview.rows as BastidorRowDraft[]);
        setSummary(preview.summary);
        setStep("review");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al generar vista previa");
      }
    });
  }

  function handleMappingChange(next: ImportMapping) {
    const sheetChanged = mapping?.sheetName !== next.sheetName;
    setMapping(next);
    if (sessionId && sheetChanged) {
      startTransition(async () => {
        try {
          await refreshColumnOptions(sessionId, next);
        } catch {
          /* ignore */
        }
      });
    }
  }

  function handleEditRow(rowIndex: number, patch: Partial<BastidorRowDraft>) {
    setRowEdits((prev) => {
      const existing = prev.findIndex((e) => e.rowIndex === rowIndex);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = {
          rowIndex,
          patch: { ...copy[existing].patch, ...patch },
        };
        return copy;
      }
      return [...prev, { rowIndex, patch }];
    });
    setRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)),
    );
  }

  const blockingErrors = countBlockingImportErrors(rows);

  function confirmImport() {
    if (!sessionId || summary == null) return;
    if (blockingErrors > 0) {
      toast.error(
        "Hay filas con error sin marcar como «Omitir». Corrígelas u omítelas antes de importar.",
      );
      return;
    }
    startTransition(async () => {
      try {
        const preview = await buildImportPreview({
          sessionId,
          mapping: mapping!,
          rowEdits: rowEdits.length ? rowEdits : undefined,
        });
        const result = await applyImportPreview({
          sessionId,
          rows: preview.rows as BastidorRowDraft[],
        });
        setApplyResult(result);
        setStep("done");
        toast.success("Importación completada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al importar");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {(Object.keys(STEP_LABELS) as WizardStep[]).map((s) => (
          <span
            key={s}
            className={
              step === s ? "text-foreground font-semibold" : "opacity-60"
            }
          >
            {STEP_LABELS[s]}
          </span>
        ))}
      </div>

      {step === "upload" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>Archivo Excel (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Compatible con PRODUCCION.xlsx: hoja BBDD (bastidores y procesos con
            horas por unidad).
          </p>
        </div>
      )}

      {step === "mapping" && mapping && (
        <div className="space-y-4">
          <ImportMappingStep
            sheetNames={sheetNames}
            columnOptions={columnOptions}
            mapping={mapping}
            onMappingChange={handleMappingChange}
            disabled={pending}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={reset} disabled={pending}>
              Cambiar archivo
            </Button>
            <Button type="button" onClick={runPreview} disabled={pending}>
              {pending ? "Procesando…" : "Generar vista previa"}
            </Button>
          </div>
        </div>
      )}

      {step === "review" && summary && (
        <div className="space-y-4">
          <ImportReviewStep
            rows={rows}
            summary={summary}
            catalog={catalog}
            onEditRow={handleEditRow}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("mapping")}
              disabled={pending}
            >
              Volver al mapeo
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={runPreview}
              disabled={pending}
            >
              Revalidar
            </Button>
            <Button
              type="button"
              onClick={confirmImport}
              disabled={pending || blockingErrors > 0}
            >
              {pending ? "Importando…" : "Importar definitivamente"}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && applyResult && (
        <div className="space-y-4">
          <ImportFinalStep result={applyResult} />
          <Button type="button" variant="outline" onClick={reset}>
            Nueva importación
          </Button>
        </div>
      )}
    </div>
  );
}
