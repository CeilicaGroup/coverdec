import { prisma } from "@/lib/db";
import {
  buildWeeklyScheduleFromWorkWindows,
  isoWeekdayForSchedule,
} from "@/features/planning/person-day-capacity";
import {
  allocateSequentialTimeSlots,
  type BusyInterval,
} from "./allocate-sequential-time-slots";
import {
  createAlreadyImportedChecker,
  horasContentFingerprints,
  loadImportedHorasIndex,
} from "./horas-fingerprint";
import { loadLegacyEntityIndex } from "./load-entity-index";
import {
  matchLampByName,
  matchProjectByName,
  matchTask,
  matchUserByOperatorName,
} from "./match-legacy-entities";
import type { ImportDb } from "./transaction";
import type {
  HorasRowDraft,
  ImportAction,
  ImportIssue,
  ImportPreview,
  ImportPreviewSummary,
  ImportRowStatus,
} from "./types";

function buildSummary(rows: HorasRowDraft[]): ImportPreviewSummary {
  return {
    total: rows.length,
    ok: rows.filter((r) => r.status === "ok").length,
    warning: rows.filter((r) => r.status === "warning").length,
    error: rows.filter((r) => r.status === "error").length,
    skipped: rows.filter((r) => r.status === "skipped").length,
    willCreate: rows.filter((r) => r.action === "create").length,
    willUpdate: rows.filter((r) => r.action === "update").length,
    willSkip: rows.filter((r) => r.action === "skip").length,
  };
}

type WeeklyWindows = { dayOfWeek: number; startMinutes: number; endMinutes: number }[];

async function loadPersonWindowsByUserId(db: ImportDb): Promise<Map<string, WeeklyWindows>> {
  const users = await db.user.findMany({
    where: { personId: { not: null } },
    select: {
      id: true,
      person: {
        select: {
          workWindows: {
            select: { dayOfWeek: true, startMinutes: true, endMinutes: true },
          },
        },
      },
    },
  });
  const map = new Map<string, WeeklyWindows>();
  for (const user of users) {
    if (user.person) map.set(user.id, user.person.workWindows);
  }
  return map;
}

function windowsForUserOnDate(
  userId: string,
  workDate: Date,
  personWindows: Map<string, WeeklyWindows>,
) {
  const weekly = buildWeeklyScheduleFromWorkWindows(
    personWindows.get(userId) ?? [],
  );
  const dayOfWeek = isoWeekdayForSchedule(workDate);
  const day = weekly.find((d) => d.dayOfWeek === dayOfWeek);
  return day?.windows;
}

const DAY_MS = 86_400_000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Tramos ya ocupados (fichajes, partes manuales, importaciones previas) por usuario y día. */
async function loadBusyByUserDay(
  db: ImportDb,
  wanted: Array<{ userId: string; workDate: Date }>,
): Promise<Map<string, BusyInterval[]>> {
  const busy = new Map<string, BusyInterval[]>();
  if (wanted.length === 0) return busy;
  const days = wanted.map((w) =>
    Date.UTC(w.workDate.getUTCFullYear(), w.workDate.getUTCMonth(), w.workDate.getUTCDate()),
  );
  const from = new Date(Math.min(...days));
  const to = new Date(Math.max(...days) + DAY_MS);
  const entries = await db.timeEntry.findMany({
    where: {
      userId: { in: [...new Set(wanted.map((w) => w.userId))] },
      startedAt: { lt: to },
      OR: [{ endedAt: null }, { endedAt: { gt: from } }],
    },
    select: { userId: true, startedAt: true, endedAt: true, hours: true },
  });
  for (const e of entries) {
    const start = e.startedAt.getTime();
    // Cronómetro en marcha: ocupa hasta ahora (o sus horas, si es mayor).
    const end = e.endedAt?.getTime() ?? Math.max(start + (e.hours ?? 0) * 3_600_000, Date.now());
    for (let day = Math.floor(start / DAY_MS) * DAY_MS; day < end; day += DAY_MS) {
      const key = `${e.userId}::${dayKey(new Date(day))}`;
      const list = busy.get(key) ?? [];
      list.push({
        startMinutes: Math.max(0, (start - day) / 60_000),
        endMinutes: Math.min(24 * 60, (end - day) / 60_000),
      });
      busy.set(key, list);
    }
  }
  return busy;
}

export async function enrichHorasPreview(
  rows: HorasRowDraft[],
  db: ImportDb = prisma,
): Promise<ImportPreview<HorasRowDraft>> {
  const [index, personWindows, imported] = await Promise.all([
    loadLegacyEntityIndex(db),
    loadPersonWindowsByUserId(db),
    loadImportedHorasIndex(db),
  ]);
  const fingerprints = horasContentFingerprints(rows);
  const isAlreadyImported = createAlreadyImportedChecker(imported);

  // 1) Emparejar cada fila con operario, proyecto, lámpara y tarea.
  const matched = rows.map((row) => {
    if (row.status === "skipped") {
      return { row, issues: row.issues, alreadyImported: false };
    }

    const issues = [...row.issues];
    let userId: string | null = null;
    let operatorLabel: string | null = null;
    let projectId: string | null = null;
    let lampId: string | null = null;
    let taskId: string | null = null;

    const user = matchUserByOperatorName(index, row.operatorName);
    if (!user) {
      issues.push({
        code: "UNKNOWN_OPERATOR",
        field: "operatorName",
        message: `Operario no encontrado: "${row.operatorName}"`,
        severity: "error",
      });
    } else {
      userId = user.id;
      operatorLabel = user.name;
    }

    const project = row.projectName
      ? matchProjectByName(index, row.projectName)
      : null;
    if (!project) {
      issues.push({
        code: "UNKNOWN_PROJECT",
        field: "projectName",
        message: `Proyecto no encontrado: "${row.projectName}" (importa Proyectos antes)`,
        severity: "error",
      });
    } else {
      projectId = project.id;
    }

    if (project && row.lampName) {
      const lamp = matchLampByName(index, project.id, row.lampName);
      if (!lamp) {
        issues.push({
          code: "UNKNOWN_LAMP",
          field: "lampName",
          message: `Lámpara no encontrada en el proyecto: "${row.lampName}"`,
          severity: "error",
        });
      } else {
        lampId = lamp.id;
      }
    }

    if (projectId && lampId && row.processCode) {
      const task = matchTask({
        index,
        projectId,
        lampId,
        process: row.processCode,
        areaName: row.areaName,
      });
      if (!task) {
        issues.push({
          code: "UNKNOWN_TASK",
          field: "processName",
          message: `Tarea no encontrada para proceso "${row.processName}"`,
          severity: "error",
        });
      } else {
        taskId = task.id;
      }
    }

    const resolved = { ...row, userId, operatorLabel, projectId, lampId, taskId };
    const alreadyImported = isAlreadyImported(resolved, fingerprints.get(row.rowIndex) ?? "");
    if (alreadyImported) {
      issues.push({
        code: "ALREADY_IMPORTED",
        message: "Esta fila ya fue importada anteriormente",
        severity: "warning",
      });
    }
    return { row: resolved, issues, alreadyImported };
  });

  // 2) Colocar en la jornada solo lo que se va a importar, sin pisar horas ya registradas.
  const groups = new Map<string, HorasRowDraft[]>();
  for (const { row, issues, alreadyImported } of matched) {
    if (row.status === "skipped" || row.action === "skip" || alreadyImported) continue;
    if (!row.workDate || !row.userId) continue;
    if (issues.some((i) => i.severity === "error")) continue;
    const key = `${row.userId}::${dayKey(row.workDate)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const busyByUserDay = await loadBusyByUserDay(
    db,
    [...groups.values()].map((g) => ({ userId: g[0]!.userId!, workDate: g[0]!.workDate! })),
  );

  const slotByRowIndex = new Map<number, { startedAt: Date; endedAt: Date }>();
  const slotIssues = new Map<number, ImportIssue[]>();
  const pushSlotIssue = (rowIndex: number, issue: ImportIssue) => {
    const list = slotIssues.get(rowIndex) ?? [];
    list.push(issue);
    slotIssues.set(rowIndex, list);
  };

  for (const [key, groupRows] of groups) {
    const sample = groupRows[0]!;
    const result = allocateSequentialTimeSlots({
      workDate: sample.workDate!,
      weeklyWindows: windowsForUserOnDate(sample.userId!, sample.workDate!, personWindows),
      busy: busyByUserDay.get(key) ?? [],
      entries: groupRows
        .filter((r) => r.totalHours != null && r.totalHours > 0)
        .map((r) => ({
          rowIndex: r.rowIndex,
          hours: r.totalHours!,
          startTimeMinutes: r.startTimeMinutes,
          endTimeMinutes: r.endTimeMinutes,
        })),
    });
    for (const slot of result.slots) slotByRowIndex.set(slot.rowIndex, slot);
    for (const w of result.warnings) {
      pushSlotIssue(w.rowIndex, { code: "SCHEDULE_WARNING", message: w.message, severity: "warning" });
    }
    for (const e of result.errors) {
      pushSlotIssue(e.rowIndex, { code: e.code, field: "normalHours", message: e.message, severity: "error" });
    }
  }

  // 3) Estado y acción final.
  const enriched = matched.map(({ row, issues: baseIssues, alreadyImported }) => {
    if (row.status === "skipped") return row;
    const issues = [...baseIssues, ...(slotIssues.get(row.rowIndex) ?? [])];
    const slot = slotByRowIndex.get(row.rowIndex);

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const status: ImportRowStatus = hasError
      ? "error"
      : hasWarning
        ? "warning"
        : "ok";

    let action: ImportAction = row.action;
    if (hasError || alreadyImported) action = "skip";
    else if (action !== "skip") action = "create";

    return {
      ...row,
      startedAt: slot?.startedAt ?? null,
      endedAt: slot?.endedAt ?? null,
      issues,
      status,
      action,
    };
  });

  return { rows: enriched, summary: buildSummary(enriched) };
}

export function mergeHorasRowEdits(
  rows: HorasRowDraft[],
  edits: Array<{ rowIndex: number; patch: Partial<HorasRowDraft> }>,
): HorasRowDraft[] {
  const byIndex = new Map(edits.map((e) => [e.rowIndex, e.patch]));
  return rows.map((row) => {
    const patch = byIndex.get(row.rowIndex);
    if (!patch) return row;
    return { ...row, ...patch };
  });
}
