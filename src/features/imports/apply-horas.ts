import { TimeEntrySource } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { HorasApplySummary, HorasRowDraft } from "./types";
import { legacyHorasImportNote } from "./types";
import { runImportTransaction } from "./transaction";

export async function applyHorasRows(
  rows: HorasRowDraft[],
): Promise<HorasApplySummary> {
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

  const existing = await prisma.timeEntry.findMany({
    where: { notes: { startsWith: "legacy-import:horas:row:" } },
    select: { notes: true },
  });
  const importedRows = new Set(
    existing.map((e) => e.notes).filter(Boolean) as string[],
  );

  await runImportTransaction(async (tx) => {
    for (const row of importable) {
      const fingerprint = legacyHorasImportNote(row.rowIndex);
      if (importedRows.has(fingerprint)) {
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
      importedRows.add(fingerprint);
      summary.created += 1;
      if (row.issues.some((i) => i.severity === "warning")) {
        summary.warnings += 1;
      }
    }
  });

  return summary;
}
