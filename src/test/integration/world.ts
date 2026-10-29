import { expect } from "vitest";
import { ElementTypology, ProjectKind, Role } from "@/generated/prisma";
import type { ActionResult } from "@/lib/action-result";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { defaultWeeklyTemplate } from "@/features/planning/engine/slots/person-schedule";
import { createLamp, createProject, setLampApprovedForPlanning } from "@/features/projects/actions";
import { autoGroupIdenticalTasks } from "@/features/work-orders/actions";

// ---- Sesión real de better-auth, transportada por la cabecera cookie falsa de next/headers ----

const PASSWORD = "integration-pass-123";
let cookie = "";

export function requestHeaders(): Headers {
  return new Headers(cookie ? { cookie, "user-agent": "vitest" } : { "user-agent": "vitest" });
}

export function resetSession(): void {
  cookie = "";
}

export async function loginAs(email: string): Promise<void> {
  const res = await auth.api.signInEmail({ body: { email, password: PASSWORD }, asResponse: true });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status}`);
  cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

async function createUser(email: string, name: string, role: Role, personId?: string) {
  await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  return prisma.user.update({
    where: { email },
    data: { role, emailVerified: true, personId: personId ?? null },
  });
}

export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`action failed: ${result.error}`);
  return result.data;
}

/** Espera fallo de una action con ActionResult y devuelve el mensaje. */
export function expectFail<T>(result: ActionResult<T>): string {
  expect(result.ok, "la action debía fallar").toBe(false);
  return result.ok ? "" : result.error;
}

// ---- Mundo mínimo de fábrica: 2 naves, 1 tipo de elemento, 3 operarios con especialidades ----

const PROCESSES = [
  { code: "CNC", label: "CNC", waitHours: 0 },
  { code: "ENSAMBLAJE", label: "Ensamblaje", waitHours: 0 },
  { code: "PINTURA", label: "Pintura", waitHours: 0 },
  { code: "TRANSPORTE", label: "Transporte", waitHours: 0, setupHours: 0.5 },
  { code: "IMPREVISTA", label: "Imprevista", waitHours: 0 },
  { code: "ESTIMACION_MANUAL", label: "Estimación manual", waitHours: 0 },
];

/** Horas de catálogo de TELA: CNC 0.5h/m²+1h, ENSAMBLAJE 1h/m², PINTURA 0.4h/m². */
export const TELA_PROCESSES = [
  { process: "CNC", sequence: 0, hoursPerUnit: 0.5, fixedHours: 1 },
  { process: "ENSAMBLAJE", sequence: 1, hoursPerUnit: 1, fixedHours: 0 },
  { process: "PINTURA", sequence: 2, hoursPerUnit: 0.4, fixedHours: 0 },
];

async function createPerson(iniciales: string, naveId: string, specialties: string[]) {
  const person = await prisma.person.create({
    data: {
      iniciales,
      alias: iniciales,
      color: "#000000",
      personNaves: { create: { naveId } },
      specialties: {
        create: specialties.map((process, i) => ({ process, isPrimary: i === 0 })),
      },
      workWindows: {
        create: defaultWeeklyTemplate().flatMap((day) =>
          day.windows.map((w) => ({
            dayOfWeek: day.dayOfWeek,
            startMinutes: w.startMinutes,
            endMinutes: w.endMinutes,
          })),
        ),
      },
    },
  });
  return person;
}

export async function buildWorld() {
  for (const p of PROCESSES) {
    await prisma.processDefinition.create({
      data: { ...p, bgColor: "#fff", fgColor: "#000", borderColor: "#000" },
    });
  }
  const n1 = await prisma.nave.create({ data: { codigo: "N1", nombre: "Nave 1" } });
  const n2 = await prisma.nave.create({ data: { codigo: "N2", nombre: "Nave 2" } });
  await prisma.elementTypologyNave.create({
    data: { typology: ElementTypology.TELA, defaultNaveId: n1.id },
  });
  const tela = await prisma.elementType.create({
    data: {
      code: "TELA",
      name: "Panel de tela",
      typology: ElementTypology.TELA,
      processes: { create: TELA_PROCESSES },
    },
  });
  await prisma.timeDeviationPolicy.create({ data: {} });

  // Ana: CNC + ensamblaje. Bea: pintura + ensamblaje. Carl: otra nave.
  const ana = await createPerson("ANA", n1.id, ["CNC", "ENSAMBLAJE"]);
  const bea = await createPerson("BEA", n1.id, ["PINTURA", "ENSAMBLAJE"]);
  const carl = await createPerson("CRL", n2.id, ["CNC", "ENSAMBLAJE", "PINTURA"]);

  const users = {
    admin: await createUser("admin@test.local", "Admin", Role.ADMIN),
    jefe: await createUser("jefe@test.local", "Jefe", Role.JEFE_PRODUCCION),
    ana: await createUser("ana@test.local", "Ana", Role.OPERARIO, ana.id),
    bea: await createUser("bea@test.local", "Bea", Role.OPERARIO, bea.id),
    carl: await createUser("carl@test.local", "Carl", Role.OPERARIO, carl.id),
  };

  return { naves: { n1, n2 }, tela, people: { ana, bea, carl }, users };
}

export type World = Awaited<ReturnType<typeof buildWorld>>;

/**
 * Flujo real de oficina: proyecto → lámpara de catálogo → aprobación → «Agrupar tareas idénticas»,
 * que crea una OT por tipo de elemento + proceso (como en producción).
 */
export async function createPlannableLamp(
  world: World,
  opts: { name?: string; surfaceM2?: number; units?: number; deliveryDate?: string } = {},
) {
  await loginAs(world.users.admin.email);
  const project = unwrap(
    await createProject({
      name: opts.name ?? "Hotel Test",
      kind: ProjectKind.PRODUCCION,
      isBillable: true,
      deliveryDate: opts.deliveryDate,
    }),
  );
  const lamp = unwrap(
    await createLamp({
      projectId: project.id,
      name: "Lámpara A",
      elements: [
        {
          typology: ElementTypology.TELA,
          elementTypeId: world.tela.id,
          surfaceM2: opts.surfaceM2 ?? 2,
          units: opts.units ?? 1,
        },
      ],
    }),
  );
  unwrap(await setLampApprovedForPlanning({ lampId: lamp.id, isApprovedForPlanning: true }));
  unwrap(await autoGroupIdenticalTasks());
  const tasks = await prisma.task.findMany({
    where: { lampId: lamp.id },
    orderBy: [{ lampElementId: "asc" }, { order: "asc" }],
  });
  const workOrderIdByProcess = Object.fromEntries(
    tasks.filter((t) => t.workOrderId).map((t) => [t.process, t.workOrderId!]),
  );
  return { projectId: project.id, lampId: lamp.id, tasks, workOrderIdByProcess };
}
