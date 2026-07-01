"use client";

import type { ImportApplyResult } from "@/features/imports/types";

interface ImportFinalStepProps {
  result: ImportApplyResult;
}

export function ImportFinalStep({ result }: ImportFinalStepProps) {
  if (result.importKind === "produccion_completa") {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Migración PRODUCCION completada</p>
        {result.bastidores && (
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              Bastidores: {result.bastidores.created} creados,{" "}
              {result.bastidores.updated} actualizados
            </li>
            <li>{result.bastidores.processesCreated} procesos nuevos en catálogo</li>
          </ul>
        )}
        {result.proyectos && (
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>
              Proyectos: {result.proyectos.projectsCreated} creados,{" "}
              {result.proyectos.projectsUpdated} actualizados,{" "}
              {result.proyectos.projectsArchived} archivados
            </li>
            <li>
              Tareas: {result.proyectos.tasksCreated} creadas,{" "}
              {result.proyectos.tasksUpdated} actualizadas
            </li>
          </ul>
        )}
        {result.horas && (
          <ul className="list-disc pl-5 text-muted-foreground">
            <li>{result.horas.created} partes de horas creados</li>
            <li>{result.horas.skipped} filas omitidas</li>
          </ul>
        )}
      </div>
    );
  }

  if (result.importKind === "proyectos" && result.proyectos) {
    const p = result.proyectos;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Importación de proyectos completada</p>
        <ul className="list-disc pl-5 text-muted-foreground">
          <li>{p.projectsCreated} proyectos creados</li>
          <li>{p.projectsUpdated} proyectos actualizados</li>
          <li>{p.projectsArchived} proyectos archivados</li>
          <li>{p.lampsCreated} lámparas creadas</li>
          <li>{p.tasksCreated} tareas creadas</li>
          <li>{p.tasksUpdated} tareas actualizadas</li>
          <li>{p.skipped} filas omitidas</li>
        </ul>
      </div>
    );
  }

  if (result.importKind === "horas" && result.horas) {
    const h = result.horas;
    return (
      <div className="space-y-2 text-sm">
        <p className="font-semibold">Importación de horas completada</p>
        <ul className="list-disc pl-5 text-muted-foreground">
          <li>{h.created} partes creados</li>
          <li>{h.skipped} filas omitidas</li>
          {h.warnings > 0 && <li>{h.warnings} avisos</li>}
        </ul>
      </div>
    );
  }

  const s = result.bastidores;
  if (!s) return null;

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
