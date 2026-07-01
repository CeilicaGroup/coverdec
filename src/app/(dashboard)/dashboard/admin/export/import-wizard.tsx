"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
import {
  applyImportPreview,
  buildImportPreview,
  getImportCatalogOptions,
  getSheetColumnsForMapping,
  inspectImportFile,
} from "@/features/imports/actions";
import {
  suggestMappingForKind,
} from "@/features/imports/legacy-produccion-presets";
import {
  countBlockingImportErrors,
  type BastidorRowDraft,
  type HorasRowDraft,
  type ImportApplyResult,
  type ImportKind,
  type ImportMapping,
  type ImportPreviewSummary,
  type ProyectoRowDraft,
  type SheetColumnOption,
} from "@/features/imports/types";
import { ImportMappingStep } from "./import-mapping-step";
import { ImportReviewStep } from "./import-review-step";
import {
  ImportHorasReviewStep,
  ImportProyectosReviewStep,
} from "./import-review-proyectos-horas";
import { ImportFinalStep } from "./import-final-step";

type WizardStep = "upload" | "mapping" | "review" | "done";

const STEP_LABELS: Record<WizardStep, string> = {
  upload: "1. Archivo",
  mapping: "2. Mapeo",
  review: "3. Revisión",
  done: "4. Completado",
};

const KIND_LABELS: Record<ImportKind, string> = {
  bastidores: "Bastidores (BBDD)",
  proyectos: "Proyectos",
  horas: "Horas",
  produccion_completa: "Migración PRODUCCION completa",
};

type ImportRow = BastidorRowDraft | ProyectoRowDraft | HorasRowDraft;

export function ImportWizard() {
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState<WizardStep>("upload");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [availableKinds, setAvailableKinds] = useState<ImportKind[]>([]);
  const [importKind, setImportKind] = useState<ImportKind>("bastidores");
  const [columnOptions, setColumnOptions] = useState<SheetColumnOption[]>([]);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [summary, setSummary] = useState<ImportPreviewSummary | null>(null);
  const [applyResult, setApplyResult] = useState<ImportApplyResult | null>(null);
  const [catalog, setCatalog] = useState<{
    processes: { code: string; label: string }[];
    frames: { id: string; name: string; code: string }[];
    users: { id: string; name: string }[];
  }>({ processes: [], frames: [], users: [] });
  const [rowEdits, setRowEdits] = useState<
    Array<{ rowIndex: number; patch: Record<string, unknown> }>
  >([]);

  const reset = useCallback(() => {
    setStep("upload");
    setSessionId(null);
    setSheetNames([]);
    setAvailableKinds([]);
    setImportKind("bastidores");
    setColumnOptions([]);
    setMapping(null);
    setRows([]);
    setSummary(null);
    setApplyResult(null);
    setRowEdits([]);
  }, []);

  useEffect(() => {
    getImportCatalogOptions(importKind)
      .then(setCatalog)
      .catch(() => undefined);
  }, [importKind]);

  async function refreshColumnOptions(
    sid: string,
    map: ImportMapping,
    kind: ImportKind,
  ): Promise<SheetColumnOption[]> {
    const options = await getSheetColumnsForMapping({
      sessionId: sid,
      sheetName: map.sheetName,
      importKind: kind,
    });
    setColumnOptions(options);
    return options;
  }

  function handleUpload(file: File, kind: ImportKind) {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("file", file);
        fd.set("importKind", kind);
        const inspected = await inspectImportFile(fd);
        setSessionId(inspected.sessionId);
        setSheetNames(inspected.sheetNames);
        setAvailableKinds(inspected.availableKinds);
        setImportKind(inspected.importKind);
        setMapping(inspected.suggestedMapping);
        setColumnOptions(inspected.columnOptions);
        setStep(inspected.importKind === "produccion_completa" ? "review" : "mapping");

        if (inspected.importKind === "produccion_completa") {
          const preview = await buildImportPreview({
            sessionId: inspected.sessionId,
            importKind: "bastidores",
            mapping: inspected.suggestedMapping,
          });
          setRows(preview.rows);
          setSummary(preview.summary);
          toast.success("Archivo listo para migración completa");
        } else {
          toast.success(
            `Archivo cargado (${inspected.sampleRowCount} filas detectadas)`,
          );
        }
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
          importKind,
          mapping,
          rowEdits: rowEdits.length ? rowEdits : undefined,
        });
        setRows(preview.rows);
        setSummary(preview.summary);
        setStep("review");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al generar vista previa");
      }
    });
  }

  function handleKindChange(kind: ImportKind) {
    setImportKind(kind);
    if (!sessionId) return;
    const nextMapping = suggestMappingForKind(sheetNames, kind);
    setMapping(nextMapping);
    startTransition(async () => {
      try {
        await refreshColumnOptions(sessionId, nextMapping, kind);
      } catch {
        /* ignore */
      }
    });
  }

  function handleMappingChange(next: ImportMapping) {
    const sheetChanged = mapping?.sheetName !== next.sheetName;
    setMapping(next);
    if (sessionId && sheetChanged) {
      startTransition(async () => {
        try {
          await refreshColumnOptions(sessionId, next, importKind);
        } catch {
          /* ignore */
        }
      });
    }
  }

  function handleEditRow(rowIndex: number, patch: Record<string, unknown>) {
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
    if (!sessionId) return;
    if (importKind !== "produccion_completa" && summary == null) return;
    if (importKind !== "produccion_completa" && blockingErrors > 0) {
      toast.error(
        "Hay filas con error sin marcar como «Omitir». Corrígelas u omítelas antes de importar.",
      );
      return;
    }
    startTransition(async () => {
      try {
        let rowsToApply = rows;
        if (importKind !== "produccion_completa" && mapping) {
          const preview = await buildImportPreview({
            sessionId,
            importKind,
            mapping,
            rowEdits: rowEdits.length ? rowEdits : undefined,
          });
          rowsToApply = preview.rows;
        }
        const result = await applyImportPreview({
          sessionId,
          importKind,
          rows: rowsToApply as BastidorRowDraft[],
        });
        setApplyResult(result);
        setStep("done");
        toast.success("Importación completada");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Error al importar");
      }
    });
  }

  const effectiveKind =
    importKind === "produccion_completa" ? "bastidores" : importKind;

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
          <div className="space-y-2 max-w-sm">
            <Label>Tipo de importación</Label>
            <Select
              value={importKind}
              onValueChange={(v) => v && setImportKind(v as ImportKind)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as ImportKind[]).map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Archivo Excel (.xlsx)</Label>
            <Input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={pending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file, importKind);
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Compatible con PRODUCCION.xlsx: hojas BBDD, Proyectos y Horas. La
            migración completa importa bastidores, proyectos y horas en orden.
          </p>
        </div>
      )}

      {step === "mapping" && mapping && (
        <div className="space-y-4">
          {availableKinds.length > 1 && (
            <div className="space-y-2 max-w-sm">
              <Label>Tipo de importación</Label>
              <Select
                value={importKind}
                onValueChange={(v) => v && handleKindChange(v as ImportKind)}
                disabled={pending}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableKinds.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <ImportMappingStep
            sheetNames={sheetNames}
            columnOptions={columnOptions}
            mapping={mapping}
            importKind={effectiveKind}
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

      {step === "review" && (summary || importKind === "produccion_completa") && (
        <div className="space-y-4">
          {importKind === "produccion_completa" ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <p>
                Se importarán en orden: <strong>BBDD</strong> (bastidores),{" "}
                <strong>Proyectos</strong> y <strong>Horas</strong> con los presets
                legacy del archivo.
              </p>
              <p className="text-xs">
                No hay revisión fila a fila en migración completa; los errores se
                omitirán según las reglas de cada hoja.
              </p>
            </div>
          ) : effectiveKind === "proyectos" ? (
            <ImportProyectosReviewStep
              rows={rows as ProyectoRowDraft[]}
              summary={summary!}
              onEditRow={handleEditRow}
            />
          ) : effectiveKind === "horas" ? (
            <ImportHorasReviewStep
              rows={rows as HorasRowDraft[]}
              summary={summary!}
              onEditRow={handleEditRow}
            />
          ) : (
            <ImportReviewStep
              rows={rows as BastidorRowDraft[]}
              summary={summary!}
              catalog={catalog}
              onEditRow={handleEditRow}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {importKind !== "produccion_completa" && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep("mapping")}
                disabled={pending}
              >
                Volver al mapeo
              </Button>
            )}
            {importKind !== "produccion_completa" && (
              <Button
                type="button"
                variant="outline"
                onClick={runPreview}
                disabled={pending}
              >
                Revalidar
              </Button>
            )}
            {importKind === "produccion_completa" && (
              <Button type="button" variant="outline" onClick={reset} disabled={pending}>
                Cancelar
              </Button>
            )}
            <Button
              type="button"
              onClick={confirmImport}
              disabled={
                pending ||
                (importKind !== "produccion_completa" && blockingErrors > 0)
              }
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
