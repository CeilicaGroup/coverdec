import { NotificationType } from "@/generated/prisma";
import { childLogger } from "@/lib/logger";
import { emitNotification, resolveNotificationStates } from "@/features/notifications/service";
import {
  computeCatalogDeviationForPair,
  getTimeDeviationPolicy,
  listCatalogTimeDeviations,
  resolveElementTypeProcessFromTaskId,
} from "./catalog-time-stats";

const log = childLogger({ module: "time-tracking.task-time-deviation-scan" });

function scopeKey(elementTypeId: string, process: string): string {
  return `task-time-deviation:${elementTypeId}:${process}`;
}

export async function evaluateCatalogTimeDeviation(args: {
  elementTypeId: string;
  process: string;
}): Promise<void> {
  const policy = await getTimeDeviationPolicy();
  const row = await computeCatalogDeviationForPair({
    elementTypeId: args.elementTypeId,
    process: args.process,
    policy,
  });
  if (!row) return;

  const key = scopeKey(args.elementTypeId, args.process);

  if (row.isAlert && row.observedHoursPerUnit != null && row.deviationPct != null) {
    await emitNotification({
      type: NotificationType.TASK_TIME_DEVIATION_FROM_CATALOG,
      title: "Desviación de tiempos en catálogo",
      body: `${row.frameTypeCode} · ${row.process}: media observada ${row.observedHoursPerUnit.toFixed(2)} h/m² vs catálogo ${row.catalogHoursPerUnit.toFixed(2)} h/m² (${row.deviationPct.toFixed(0)}% desviación, ${row.sampleCount} muestras).`,
      payload: {
        eventKey: key,
        elementTypeId: row.elementTypeId,
        process: row.process,
        frameTypeCode: row.frameTypeCode,
        frameTypeName: row.frameTypeName,
        catalogHoursPerUnit: row.catalogHoursPerUnit,
        observedHoursPerUnit: row.observedHoursPerUnit,
        deviationPct: row.deviationPct,
        sampleCount: row.sampleCount,
      },
      scopeKey: key,
    });
    log.info(
      { elementTypeId: args.elementTypeId, process: args.process, deviationPct: row.deviationPct },
      "catalog time deviation alert emitted",
    );
    return;
  }

  await resolveNotificationStates({
    type: NotificationType.TASK_TIME_DEVIATION_FROM_CATALOG,
    scopeKeys: [key],
  });
}

export async function evaluateCatalogTimeDeviationForTask(taskId: string): Promise<void> {
  const pair = await resolveElementTypeProcessFromTaskId(taskId);
  if (!pair) return;
  await evaluateCatalogTimeDeviation(pair);
}

export async function scanTaskTimeDeviations(): Promise<void> {
  const { rows } = await listCatalogTimeDeviations();
  const activeKeys = new Set<string>();
  for (const row of rows) {
    const key = scopeKey(row.elementTypeId, row.process);
    if (row.isAlert) {
      activeKeys.add(key);
      await evaluateCatalogTimeDeviation({
        elementTypeId: row.elementTypeId,
        process: row.process,
      });
    }
  }

  const allKeys = rows.map((r) => scopeKey(r.elementTypeId, r.process));
  const resolved = allKeys.filter((k) => !activeKeys.has(k));
  if (resolved.length > 0) {
    await resolveNotificationStates({
      type: NotificationType.TASK_TIME_DEVIATION_FROM_CATALOG,
      scopeKeys: resolved,
    });
  }
}
