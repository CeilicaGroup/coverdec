import { TimeEntrySource } from "@/generated/prisma";
import {
  createAlreadyImportedChecker,
  horasContentFingerprints,
  loadImportedHorasIndex,
} from "./horas-fingerprint";
import { runImportTransaction, type ImportDb } from "./transaction";
import type { HorasApplySummary, HorasRowDraft } from "./types";

/** Sin `tx` abre su propia transacción; con `tx` se integra en una mayor (migración completa). */
export async function applyHorasRows(
  rows: HorasRowDraft[],
  tx?: ImportDb,
): Promise<HorasApplySummary> {
  if (!tx) return runImportTransaction((t) => applyHorasRows(rows, t));

  const summary: HorasApplySummary = {
    created: 0,
    skipped: 0,
    warnings: 0,
  };

  const importable = rows.filter(
    (r) =>
      r.action !== "skip" &&
      r.userId &&
      r.taskId &&
      r.projectId &&
      r.lampId &&
      r.processCode &&
      r.workDate &&
      r.totalHours != null &&
      r.totalHours > 0 &&
      r.startedAt &&
      r.endedAt,
  );
  summary.skipped = rows.length - importable.length;

  // La marca se recalcula en servidor a partir del contenido: no se confía en la vista previa.
  // El comprobador recorre todas las filas en orden de hoja, igual que la vista previa, para que
  // las entradas antiguas se asignen a las mismas filas.
  const fingerprints = horasContentFingerprints(rows);
  const imported = await loadImportedHorasIndex(tx);
  const isAlreadyImported = createAlreadyImportedChecker(imported);
  const alreadyImported = new Set(
    [...rows]
      .sort((a, b) => a.rowIndex - b.rowIndex)
      .filter((r) => r.status !== "skipped" && isAlreadyImported(r, fingerprints.get(r.rowIndex)!))
      .map((r) => r.rowIndex),
  );

  for (const row of importable) {
    const fingerprint = fingerprints.get(row.rowIndex)!;
    if (alreadyImported.has(row.rowIndex) || imported.contentMarkers.has(fingerprint)) {
      summary.skipped += 1;
      if (row.issues.some((i) => i.code === "ALREADY_IMPORTED")) {
        summary.warnings += 1;
      }
      continue;
    }

    const noteParts = [fingerprint];
    if (row.notes) noteParts.push(row.notes);

    await tx.timeEntry.create({
      data: {
        userId: row.userId!,
        projectId: row.projectId!,
        lampId: row.lampId!,
        taskId: row.taskId!,
        process: row.processCode!,
        source: TimeEntrySource.MANUAL,
        startedAt: row.startedAt!,
        endedAt: row.endedAt!,
        hours: row.totalHours!,
        notes: noteParts.join(" | "),
      },
    });
    imported.contentMarkers.add(fingerprint);
    summary.created += 1;
    if (row.issues.some((i) => i.severity === "warning")) {
      summary.warnings += 1;
    }
  }

  return summary;
}
