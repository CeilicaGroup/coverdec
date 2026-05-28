"use client";

import type { ImportApplyResult } from "@/features/imports/types";

interface ImportFinalStepProps {
  result: ImportApplyResult;
}

export function ImportFinalStep({ result }: ImportFinalStepProps) {
  const s = result.bastidores;

  return (
    <div className="space-y-2 text-sm">
      <p className="font-semibold">Importación completada</p>
      <ul className="list-disc pl-5 text-muted-foreground">
        <li>{s.created} bastidores creados</li>
        <li>{s.updated} bastidores actualizados</li>
        <li>{s.processesCreated} procesos nuevos en catálogo</li>
        <li>{s.skipped} filas omitidas</li>
      </ul>
      <p className="text-xs text-muted-foreground">
        La importación se ejecutó en una sola transacción: si hubiera fallado
        algún paso, no se habría guardado ningún cambio.
      </p>
    </div>
  );
}
