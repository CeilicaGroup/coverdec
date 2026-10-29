import { prisma } from "@/lib/db";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { Role, TaskSystemKind } from "@/generated/prisma";
import { formatAdHocPersonLabel } from "./resolve-ad-hoc-nave";
import { pickCanonicalPersonNave } from "@/features/people/person-naves";

// Lecturas solo para Server Components: fuera del módulo "use server" para no
// exponerlas como endpoints ni auditarlas en cada render.

export interface PendingAdHocTaskRow {
  id: string;
  projectId: string;
  notes: string | null;
  internalNotes: string | null;
  projectName: string;
  process: string;
  estimatedHours: number;
  naveId: string;
  naveLabel: string;
  createdAt: string;
  hasTimeEntries: boolean;
  participants: Array<{ id: string; label: string }>;
}

export async function listPendingAdHocTasks(
  naveScope: string[] | null,
): Promise<PendingAdHocTaskRow[]> {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  if (naveScope !== null && naveScope.length === 0) return [];

  const tasks = await prisma.task.findMany({
    where: {
      systemKind: TaskSystemKind.AD_HOC,
      isCompleted: false,
      assignments: { none: {} },
      ...(naveScope !== null ? { naveId: { in: naveScope } } : {}),
    },
    select: {
      id: true,
      notes: true,
      internalNotes: true,
      process: true,
      estimatedHours: true,
      naveId: true,
      createdAt: true,
      project: { select: { id: true, name: true } },
      nave: { select: { codigo: true, nombre: true } },
      _count: { select: { timeEntries: true } },
      participants: {
        select: {
          person: {
            select: {
              id: true,
              iniciales: true,
              alias: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return tasks.map((task) => ({
    id: task.id,
    projectId: task.project.id,
    notes: task.notes,
    internalNotes: task.internalNotes,
    projectName: task.project.name,
    process: task.process,
    estimatedHours: task.estimatedHours,
    naveId: task.naveId,
    naveLabel: `${task.nave.codigo} · ${task.nave.nombre}`,
    createdAt: task.createdAt.toISOString(),
    hasTimeEntries: task._count.timeEntries > 0,
    participants: task.participants.map(({ person }) => {
      const name = person.user?.name ?? person.alias ?? person.iniciales;
      return {
        id: person.id,
        label: formatAdHocPersonLabel({ name, iniciales: person.iniciales }),
      };
    }),
  }));
}

export async function listAdHocFormOptions() {
  const ctx = await requireDashboardContext();
  requireRole(ctx, [Role.ADMIN, Role.JEFE_PRODUCCION]);

  const [people, projects, naves, processes] = await Promise.all([
    prisma.person.findMany({
      where: { isActive: true },
      select: {
        id: true,
        iniciales: true,
        alias: true,
        user: { select: { name: true } },
        personNaves: {
          select: {
            naveId: true,
            nave: { select: { codigo: true } },
          },
        },
      },
      orderBy: { iniciales: "asc" },
    }),
    prisma.project.findMany({
      where: { isActive: true, kind: { notIn: ["STOCK", "IMPREVISTAS"] } },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
    prisma.nave.findMany({
      where: { isActive: true },
      select: { id: true, codigo: true, nombre: true },
      orderBy: { codigo: "asc" },
    }),
    prisma.processDefinition.findMany({
      select: { code: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  return {
    people: people.map((person) => {
      const canonicalNave = pickCanonicalPersonNave(person.personNaves);
      const name = person.user?.name ?? person.alias ?? person.iniciales;
      const naveIds = person.personNaves.map((row) => row.naveId);
      return {
        id: person.id,
        label: formatAdHocPersonLabel({
          name,
          iniciales: person.iniciales,
          naveCodigo: canonicalNave?.nave.codigo,
        }),
        name,
        iniciales: person.iniciales,
        naveIds,
        defaultNaveId: canonicalNave?.naveId ?? null,
      };
    }),
    projects: projects.map((p) => ({
      id: p.id,
      label: `${p.name} (${p.code})`,
    })),
    naves: naves.map((n) => ({
      id: n.id,
      label: `${n.codigo} · ${n.nombre}`,
    })),
    processes: processes.map((p) => ({
      code: p.code,
      label: p.label,
    })),
  };
}
