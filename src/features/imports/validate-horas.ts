import { prisma } from "@/lib/db";
import {
  buildWeeklyScheduleFromWorkWindows,
  isoWeekdayForSchedule,
} from "@/features/planning/person-day-capacity";
import { allocateSequentialTimeSlots } from "./allocate-sequential-time-slots";
import {
  buildLegacyEntityIndex,
  matchLampByName,
  matchProjectByName,
  matchTask,
  matchUserByOperatorName,
} from "./match-legacy-entities";
import type {
  HorasRowDraft,
  ImportAction,
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

async function loadEntityIndex() {
  const [elementTypes, projects, tasks, users] = await Promise.all([
    prisma.elementType.findMany({
      select: { id: true, name: true, code: true },
    }),
    prisma.project.findMany({
      select: {
        id: true,
        name: true,
        code: true,
        isActive: true,
        lamps: { select: { id: true, name: true, nameKey: true, projectId: true } },
      },
    }),
    prisma.task.findMany({
      select: {
        id: true,
        projectId: true,
        lampId: true,
        process: true,
        lampElementId: true,
        lampElement: {
          select: { elementType: { select: { name: true } } },
        },
      },
    }),
    prisma.user.findMany({
      select: { id: true, name: true },
    }),
  ]);

  return buildLegacyEntityIndex({
    elementTypes,
    projects,
    tasks: tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      lampId: t.lampId,
      process: t.process,
      lampElementId: t.lampElementId,
      areaLabel: t.lampElement?.elementType.name ?? null,
    })),
    users,
  });
}

async function loadPersonWindowsByUserId(): Promise<
  Map<string, { dayOfWeek: number; startMinutes: number; endMinutes: number }[]>
> {
  const users = await prisma.user.findMany({
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
  const map = new Map<
    string,
    { dayOfWeek: number; startMinutes: number; endMinutes: number }[]
  >();
  for (const user of users) {
    if (user.person) map.set(user.id, user.person.workWindows);
  }
  return map;
}

function windowsForUserOnDate(
  userId: string,
  workDate: Date,
  personWindows: Map<
    string,
    { dayOfWeek: number; startMinutes: number; endMinutes: number }[]
  >,
) {
  const weekly = buildWeeklyScheduleFromWorkWindows(
    personWindows.get(userId) ?? [],
  );
  const dayOfWeek = isoWeekdayForSchedule(workDate);
  const day = weekly.find((d) => d.dayOfWeek === dayOfWeek);
  return day?.windows;
}

export async function enrichHorasPreview(
  rows: HorasRowDraft[],
): Promise<ImportPreview<HorasRowDraft>> {
  const [index, personWindows, existingNotes] = await Promise.all([
    loadEntityIndex(),
    loadPersonWindowsByUserId(),
    prisma.timeEntry.findMany({
      where: { notes: { startsWith: "legacy-import:horas:row:" } },
      select: { notes: true },
    }),
  ]);
  const existingFingerprints = new Set(
    existingNotes.map((e) => e.notes).filter(Boolean) as string[],
  );

  const groups = new Map<string, HorasRowDraft[]>();
  for (const row of rows) {
    if (row.status === "skipped" || !row.workDate || !row.operatorName) continue;
    const key = `${row.workDate.toISOString().slice(0, 10)}::${row.operatorName}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const slotByRowIndex = new Map<
    number,
    { startedAt: Date; endedAt: Date; overflow: boolean }
  >();
  const slotWarnings = new Map<number, string[]>();

  for (const [, groupRows] of groups) {
    const sample = groupRows[0]!;
    const user = matchUserByOperatorName(index, sample.operatorName);
    const result = allocateSequentialTimeSlots({
      workDate: sample.workDate!,
      weeklyWindows: user
        ? windowsForUserOnDate(user.id, sample.workDate!, personWindows)
        : undefined,
      entries: groupRows
        .filter((r) => r.totalHours != null && r.totalHours > 0)
        .map((r) => ({
          rowIndex: r.rowIndex,
          hours: r.totalHours!,
          startTimeMinutes: r.startTimeMinutes,
          endTimeMinutes: r.endTimeMinutes,
        })),
    });
    for (const slot of result.slots) {
      slotByRowIndex.set(slot.rowIndex, slot);
    }
    for (const w of result.warnings) {
      const list = slotWarnings.get(w.rowIndex) ?? [];
      list.push(w.message);
      slotWarnings.set(w.rowIndex, list);
    }
  }

  const enriched = rows.map((row) => {
    if (row.status === "skipped") return row;

    const issues = [...row.issues];
    let userId: string | null = null;
    let operatorLabel: string | null = null;
    let projectId: string | null = null;
    let lampId: string | null = null;
    let taskId: string | null = null;
    let action: ImportAction = row.action;

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

    const fingerprint = `legacy-import:horas:row:${row.rowIndex}`;
    if (existingFingerprints.has(fingerprint)) {
      issues.push({
        code: "ALREADY_IMPORTED",
        message: "Esta fila ya fue importada anteriormente",
        severity: "warning",
      });
      action = "skip";
    }

    const slot = slotByRowIndex.get(row.rowIndex);
    const warnMessages = slotWarnings.get(row.rowIndex) ?? [];
    for (const msg of warnMessages) {
      issues.push({
        code: "SCHEDULE_WARNING",
        message: msg,
        severity: "warning",
      });
    }

    const hasError = issues.some((i) => i.severity === "error");
    const hasWarning = issues.some((i) => i.severity === "warning");
    const status: ImportRowStatus = hasError
      ? "error"
      : hasWarning
        ? "warning"
        : "ok";

    if (hasError) action = "skip";
    else if (action !== "skip") action = "create";

    return {
      ...row,
      userId,
      operatorLabel,
      projectId,
      lampId,
      taskId,
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
