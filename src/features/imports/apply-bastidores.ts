import { prisma } from "@/lib/db";
import type { ProcessCode } from "@/types/process";
import { isIsoTimestampString } from "./excel-cell-values";
import { ensureProcessDefinitions } from "./ensure-process-definitions";
import { importSlug } from "./slug";
import type { BastidorApplySummary, BastidorRowDraft } from "./types";

export async function applyBastidorRows(
  rows: BastidorRowDraft[],
): Promise<BastidorApplySummary> {
  const summary: BastidorApplySummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    processesCreated: 0,
  };

  const importable = rows.filter(
    (r) =>
      r.action !== "skip" &&
      r.processCode &&
      r.hoursPerUnit != null &&
      r.frameName.trim().length > 0 &&
      !isIsoTimestampString(r.frameName),
  );
  summary.skipped = rows.length - importable.length;

  const grouped = new Map<
    string,
    { name: string; code: string; processes: Map<ProcessCode, number> }
  >();

  const processDefs = new Map<string, string>();

  for (const row of importable) {
    const name = row.frameName.trim();
    const code = row.frameCode?.trim() || importSlug(name, 64) || name;
    if (!grouped.has(code)) {
      grouped.set(code, { name, code, processes: new Map() });
    }
    const entry = grouped.get(code)!;
    if (row.processCode && row.hoursPerUnit != null) {
      entry.processes.set(row.processCode, row.hoursPerUnit);
      processDefs.set(
        row.processCode,
        row.processName.trim() || row.processCode,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const processResult = await ensureProcessDefinitions(
      tx,
      [...processDefs.entries()].map(([code, label]) => ({ code, label })),
    );
    summary.processesCreated = processResult.created;

    for (const entry of grouped.values()) {
      const existing = await tx.frameType.findUnique({
        where: { code: entry.code },
        select: { id: true },
      });

      const frameType = await tx.frameType.upsert({
        where: { code: entry.code },
        update: { name: entry.name },
        create: { code: entry.code, name: entry.name },
      });

      if (existing) summary.updated += 1;
      else summary.created += 1;

      let sequence = 0;
      for (const [proc, hoursPerUnit] of entry.processes) {
        await tx.frameTypeProcess.upsert({
          where: {
            frameTypeId_process: { frameTypeId: frameType.id, process: proc },
          },
          update: { sequence, hoursPerUnit },
          create: {
            frameTypeId: frameType.id,
            process: proc,
            sequence,
            hoursPerUnit,
          },
        });
        sequence += 1;
      }
    }
  });

  return summary;
}
