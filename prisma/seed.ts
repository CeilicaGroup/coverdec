import { PrismaClient, Role, TimeEntrySource } from "../src/generated/prisma";
import { auth } from "../src/lib/auth";
import { defaultWeeklyTemplate } from "../src/features/planning/engine/slots/person-schedule";
import { buildTasksFromFrame } from "../src/features/projects/lamp-tasks";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "coverdec123";

const PROCESSES = [
  { code: "CNC",          label: "CNC",              factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#DBEAFE", fgColor: "#1D4ED8", borderColor: "#1D4ED8" },
  { code: "ENSAMBLAJE",   label: "Ensamblaje",        factor: 1,    setupHours: 1, waitHours: 0,  bgColor: "#DCFCE7", fgColor: "#15803D", borderColor: "#15803D" },
  { code: "LIJADO",       label: "Lijado/Masillado",  factor: 0.7,  setupHours: 2, waitHours: 0,  bgColor: "#FEF9C3", fgColor: "#A16207", borderColor: "#A16207" },
  { code: "IMPRIMACION",  label: "Imprimación",       factor: 0.55, setupHours: 0, waitHours: 12, bgColor: "#FFEDD5", fgColor: "#C2410C", borderColor: "#C2410C" },
  { code: "PINTURA",      label: "Pintura",           factor: 0.45, setupHours: 0, waitHours: 12, bgColor: "#FEE2E2", fgColor: "#B91C1C", borderColor: "#B91C1C" },
  { code: "PERFILES",     label: "Perfiles",          factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#CCFBF1", fgColor: "#0F766E", borderColor: "#0F766E" },
  { code: "EMBALAJE",     label: "Embalaje",          factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#D1FAE5", fgColor: "#166534", borderColor: "#166534" },
  { code: "PEGADO_ESPEJO",label: "Pegado espejo",     factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#EDE9FE", fgColor: "#5B21B6", borderColor: "#5B21B6" },
  { code: "CORTE_MANUAL", label: "Corte manual",      factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#F3F4F6", fgColor: "#374151", borderColor: "#374151" },
  { code: "LIMPIEZA",     label: "Limpieza",          factor: 1,    setupHours: 0, waitHours: 0,  bgColor: "#E0F2FE", fgColor: "#0369A1", borderColor: "#0369A1" },
];

const PEOPLE = [
  {
    name: "Claudio Peralta",
    alias: "Claudio",
    iniciales: "CP",
    color: "#059669",
    email: "claudio@coverdec.local",
    role: Role.JEFE_PRODUCCION,
    specialties: [
      { process: "PINTURA", isPrimary: true },
      { process: "LIJADO", isFallback: true },
      { process: "ENSAMBLAJE" },
      { process: "PERFILES" },
      { process: "EMBALAJE" },
    ],
    notes: "Responsable de nave. Único responsable de Pintura.",
  },
  {
    name: "Serhii Kotluienko",
    alias: "Sergio",
    iniciales: "SK",
    color: "#EA580C",
    email: "sergio@coverdec.local",
    role: Role.OPERARIO,
    specialties: [
      { process: "IMPRIMACION", isPrimary: true },
      { process: "ENSAMBLAJE", isFallback: true },
      { process: "PERFILES" },
      { process: "EMBALAJE" },
      { process: "LIMPIEZA" },
    ],
    notes: "Único responsable de Imprimación. Selcos metacrilato. Hair perfiles.",
  },
  {
    name: "Ihor Alieksieiev",
    alias: "Ihor",
    iniciales: "IA",
    color: "#2563EB",
    email: "ihor@coverdec.local",
    role: Role.OPERARIO,
    specialties: [
      { process: "ENSAMBLAJE", isPrimary: true },
      { process: "PERFILES", isPrimary: true },
      { process: "EMBALAJE", isPrimary: true },
      { process: "PEGADO_ESPEJO", isPrimary: true },
    ],
    notes: "Responsable de Pegado espejo Hair.",
  },
  {
    name: "Tetiana Mesriakin",
    alias: "Tetiana",
    iniciales: "TM",
    color: "#7C3AED",
    email: "tetiana@coverdec.local",
    role: Role.OPERARIO,
    specialties: [{ process: "LIJADO", isPrimary: true }],
    notes: "Especialista lijado y masillado.",
  },
  {
    name: "Daniil Shcheglov",
    alias: "Daniil",
    iniciales: "DS",
    color: "#0891B2",
    email: "daniil@coverdec.local",
    role: Role.OPERARIO,
    specialties: [
      { process: "CNC", isPrimary: true },
      { process: "ENSAMBLAJE", isFallback: true },
    ],
    notes: "Operador CNC principal. John opera CNC solo si Daniil ausente.",
  },
];

const FRAME_TYPES = [
  {
    code: "TELA",
    name: "Panel de tela",
    description: "Bastidor con tela tensada, proceso completo pintura",
    processes: [
      { process: "CNC",         sequence: 0, hoursPerUnit: 0.5,  fixedHours: 1.0 },
      { process: "ENSAMBLAJE",  sequence: 1, hoursPerUnit: 1.0,  fixedHours: 0   },
      { process: "LIJADO",      sequence: 2, hoursPerUnit: 0.7,  fixedHours: 0.5 },
      { process: "IMPRIMACION", sequence: 3, hoursPerUnit: 0.3,  fixedHours: 0   },
      { process: "PINTURA",     sequence: 4, hoursPerUnit: 0.4,  fixedHours: 0   },
      { process: "EMBALAJE",    sequence: 5, hoursPerUnit: 0.15, fixedHours: 0   },
    ],
  },
  {
    code: "ESPUMADO",
    name: "Panel espumado",
    description: "Bastidor con espumado, más horas de lijado",
    processes: [
      { process: "CNC",         sequence: 0, hoursPerUnit: 0.4,  fixedHours: 0.5 },
      { process: "ENSAMBLAJE",  sequence: 1, hoursPerUnit: 1.2,  fixedHours: 0   },
      { process: "LIJADO",      sequence: 2, hoursPerUnit: 1.0,  fixedHours: 1.0 },
      { process: "IMPRIMACION", sequence: 3, hoursPerUnit: 0.3,  fixedHours: 0   },
      { process: "PINTURA",     sequence: 4, hoursPerUnit: 0.4,  fixedHours: 0   },
      { process: "EMBALAJE",    sequence: 5, hoursPerUnit: 0.2,  fixedHours: 0   },
    ],
  },
  {
    code: "COMPOSITE",
    name: "Composite / chapa",
    description: "Panel de composite o chapa, sin pintura",
    processes: [
      { process: "CORTE_MANUAL", sequence: 0, hoursPerUnit: 0.3, fixedHours: 0 },
      { process: "ENSAMBLAJE",   sequence: 1, hoursPerUnit: 0.5, fixedHours: 0 },
      { process: "EMBALAJE",     sequence: 2, hoursPerUnit: 0.1, fixedHours: 0 },
    ],
  },
  {
    code: "HAIR",
    name: "Hair espejo",
    description: "Elemento Hair con pegado de espejo y perfiles",
    processes: [
      { process: "ENSAMBLAJE",    sequence: 0, hoursPerUnit: 1.0, fixedHours: 0 },
      { process: "PERFILES",      sequence: 1, hoursPerUnit: 0.5, fixedHours: 0 },
      { process: "PEGADO_ESPEJO", sequence: 2, hoursPerUnit: 0.3, fixedHours: 0 },
      { process: "EMBALAJE",      sequence: 3, hoursPerUnit: 0.2, fixedHours: 0 },
    ],
  },
  {
    code: "SOL",
    name: "Elemento Sol",
    description: "Elemento decorativo Sol",
    processes: [
      { process: "CNC",        sequence: 0, hoursPerUnit: 0.3,  fixedHours: 0.5 },
      { process: "ENSAMBLAJE", sequence: 1, hoursPerUnit: 0.8,  fixedHours: 0   },
      { process: "EMBALAJE",   sequence: 2, hoursPerUnit: 0.15, fixedHours: 0   },
    ],
  },
];

const PROJECTS = [
  {
    code: "druni-cc-splau",
    name: "DRUNI CC Splau",
    client: "DRUNI",
    deliveryDate: new Date("2026-07-15T00:00:00.000Z"),
    lamps: [
      { name: "Panel tela fachada", frameTypeCode: "TELA",      surfaceM2: 4.5, units: 2 },
      { name: "Composite lateral",  frameTypeCode: "COMPOSITE",  surfaceM2: 2.0, units: 1 },
      { name: "Hair espejo caja",   frameTypeCode: "HAIR",       surfaceM2: 1.5, units: 1 },
    ],
  },
  {
    code: "druni-cc-baricentro",
    name: "DRUNI CC Baricentro",
    client: "DRUNI",
    deliveryDate: new Date("2026-08-01T00:00:00.000Z"),
    lamps: [
      { name: "Panel espumado frontal", frameTypeCode: "ESPUMADO",  surfaceM2: 5.0, units: 2 },
      { name: "Composite mostrador",    frameTypeCode: "COMPOSITE",  surfaceM2: 1.8, units: 2 },
    ],
  },
  {
    code: "druni-cc-mn4",
    name: "DRUNI CC MN4",
    client: "DRUNI",
    deliveryDate: new Date("2026-08-20T00:00:00.000Z"),
    lamps: [
      { name: "Tela fachada principal", frameTypeCode: "TELA",      surfaceM2: 6.0, units: 1 },
      { name: "Hair lateral",           frameTypeCode: "HAIR",       surfaceM2: 2.0, units: 2 },
    ],
  },
  {
    code: "druni-cc-las-arenas",
    name: "DRUNI CC Las Arenas",
    client: "DRUNI",
    deliveryDate: new Date("2026-09-05T00:00:00.000Z"),
    lamps: [
      { name: "Espumado cabecera",    frameTypeCode: "ESPUMADO",  surfaceM2: 4.0, units: 1 },
      { name: "Composite zócalo",     frameTypeCode: "COMPOSITE",  surfaceM2: 3.0, units: 1 },
      { name: "Sol decorativo",       frameTypeCode: "SOL",        surfaceM2: 1.2, units: 3 },
    ],
  },
  {
    code: "druni-marbella",
    name: "DRUNI Marbella",
    client: "DRUNI",
    deliveryDate: new Date("2026-09-30T00:00:00.000Z"),
    lamps: [
      { name: "Tela fachada",     frameTypeCode: "TELA",      surfaceM2: 5.5, units: 1 },
      { name: "Hair espejo",      frameTypeCode: "HAIR",       surfaceM2: 1.8, units: 2 },
    ],
  },
  {
    code: "arenal-cc-el-rosal",
    name: "ARENAL CC El Rosal",
    client: "ARENAL",
    deliveryDate: new Date("2026-10-15T00:00:00.000Z"),
    lamps: [
      { name: "Espumado frontal",    frameTypeCode: "ESPUMADO",  surfaceM2: 7.0, units: 1 },
      { name: "Sol entrada",         frameTypeCode: "SOL",        surfaceM2: 1.5, units: 2 },
    ],
  },
  {
    code: "byd-barcelona",
    name: "BYD Barcelona",
    client: "BYD",
    deliveryDate: new Date("2026-11-01T00:00:00.000Z"),
    lamps: [
      { name: "Espumado showroom",   frameTypeCode: "ESPUMADO",  surfaceM2: 6.0, units: 1 },
      { name: "Composite columna",   frameTypeCode: "COMPOSITE",  surfaceM2: 3.0, units: 2 },
    ],
  },
  {
    code: "punto-valencia",
    name: "PUNTO Valencia",
    client: "PUNTO",
    deliveryDate: new Date("2026-11-20T00:00:00.000Z"),
    lamps: [
      { name: "Tela escaparate",  frameTypeCode: "TELA",      surfaceM2: 3.5, units: 2 },
      { name: "Hair elemento",    frameTypeCode: "HAIR",       surfaceM2: 1.2, units: 1 },
      { name: "Sol decorativo",   frameTypeCode: "SOL",        surfaceM2: 0.8, units: 4 },
    ],
  },
];

const HOLIDAYS_2026 = [
  ["2026-01-01", "Año Nuevo"],
  ["2026-01-06", "Reyes"],
  ["2026-03-19", "San José"],
  ["2026-04-02", "Jueves Santo"],
  ["2026-04-03", "Viernes Santo"],
  ["2026-04-06", "Lunes de Pascua"],
  ["2026-05-01", "Día del Trabajo"],
  ["2026-06-24", "San Juan"],
  ["2026-08-15", "Asunción"],
  ["2026-10-09", "Comunitat Valenciana"],
  ["2026-10-12", "Hispanidad"],
  ["2026-11-01", "Todos los Santos"],
  ["2026-12-06", "Constitución"],
  ["2026-12-08", "Inmaculada"],
  ["2026-12-25", "Navidad"],
] as const;
const SEEDED_TIME_ENTRY_PREFIX = "[seed] time-entry";

function seededProgress(projectCode: string, lampName: string, process: string) {
  const input = `${projectCode}:${lampName}:${process}`;
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return (hash % 76) / 100; // 0.00 .. 0.75
}

async function main() {
  console.log("Seeding processes...");
  for (const proc of PROCESSES) {
    await prisma.processDefinition.upsert({
      where: { code: proc.code },
      update: proc,
      create: proc,
    });
  }

  console.log("Seeding naves...");
  const navesData = [
    { codigo: "N1", nombre: "Nave 1" },
    { codigo: "N2", nombre: "Nave 2" },
  ];
  for (const nave of navesData) {
    await prisma.nave.upsert({
      where: { codigo: nave.codigo },
      update: nave,
      create: nave,
    });
  }
  const firstNave = await prisma.nave.findFirstOrThrow({ orderBy: { codigo: "asc" } });

  console.log("Seeding frame types...");
  const frameTypeByCode = new Map<string, { id: string }>();
  for (const ft of FRAME_TYPES) {
    const { processes, ...ftData } = ft;
    const created = await prisma.frameType.upsert({
      where: { code: ftData.code },
      update: { name: ftData.name, description: ftData.description },
      create: ftData,
    });
    frameTypeByCode.set(ftData.code, created);
    for (const fp of processes) {
      await prisma.frameTypeProcess.upsert({
        where: { frameTypeId_process: { frameTypeId: created.id, process: fp.process } },
        update: { hoursPerUnit: fp.hoursPerUnit, fixedHours: fp.fixedHours, sequence: fp.sequence },
        create: { frameTypeId: created.id, ...fp },
      });
    }
  }

  console.log("Seeding projects...");
  for (const proj of PROJECTS) {
    const { lamps, ...projData } = proj;
    const project = await prisma.project.upsert({
      where: { code: projData.code },
      update: { deliveryDate: projData.deliveryDate },
      create: projData,
    });
    for (const lamp of lamps) {
      const frameType = frameTypeByCode.get(lamp.frameTypeCode);
      if (!frameType) continue;
      const exists = await prisma.lamp.findFirst({
        where: { projectId: project.id, name: lamp.name },
      });
      if (exists) continue;
      const blueprints = await buildTasksFromFrame(frameType.id, lamp.surfaceM2);
      await prisma.$transaction(async (tx) => {
        const created = await tx.lamp.create({
          data: {
            projectId: project.id,
            frameTypeId: frameType.id,
            name: lamp.name,
            surfaceM2: lamp.surfaceM2,
            units: lamp.units,
          },
        });
        if (blueprints.length > 0) {
          await tx.task.createMany({
            data: blueprints.map((bp) => ({
              // Seed deterministic progress so dashboard metrics are meaningful.
              // Keep some pending work in every task by capping completion at 75%.
              ...(() => {
                const progress = seededProgress(project.code, lamp.name, bp.process);
                const doneHours = Number((bp.estimatedHours * progress).toFixed(2));
                const pendingHours = Number(
                  Math.max(0, bp.estimatedHours - doneHours).toFixed(2),
                );
                return {
                  estimatedHours: bp.estimatedHours,
                  doneHours,
                  pendingHours,
                };
              })(),
              projectId: project.id,
              lampId: created.id,
              process: bp.process,
              order: bp.order,
              naveId: firstNave.id,
            })),
          });
        }
      });
    }
    console.log(`  ${project.name} (${lamps.length} lámparas)`);
  }

  console.log("Seeding people...");
  const userIdByEmail = new Map<string, string>();
  const fallbackOperatorEmails: string[] = [];
  const operatorEmailsByProcess = new Map<string, string[]>();
  for (const person of PEOPLE) {
    const { specialties, email, role, name, ...personData } = person;
    const created = await prisma.person.upsert({
      where: { iniciales: personData.iniciales },
      update: personData,
      create: personData,
    });
    await prisma.personNave.upsert({
      where: {
        personId_naveId: {
          personId: created.id,
          naveId: firstNave.id,
        },
      },
      update: {},
      create: {
        personId: created.id,
        naveId: firstNave.id,
      },
    });
    for (const spec of specialties) {
      await prisma.personSpecialty.upsert({
        where: {
          personId_process: { personId: created.id, process: spec.process },
        },
        update: {
          isPrimary: "isPrimary" in spec ? !!spec.isPrimary : false,
          isFallback: "isFallback" in spec ? !!spec.isFallback : false,
        },
        create: {
          personId: created.id,
          process: spec.process,
          isPrimary: "isPrimary" in spec ? !!spec.isPrimary : false,
          isFallback: "isFallback" in spec ? !!spec.isFallback : false,
        },
      });
    }
    await prisma.personWorkWindow.deleteMany({ where: { personId: created.id } });
    for (const day of defaultWeeklyTemplate()) {
      for (const w of day.windows) {
        await prisma.personWorkWindow.create({
          data: {
            personId: created.id,
            dayOfWeek: day.dayOfWeek,
            startMinutes: w.startMinutes,
            endMinutes: w.endMinutes,
          },
        });
      }
    }

    // Crear usuario vinculado si no existe
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (!existingUser) {
      await auth.api.signUpEmail({
        body: { email, password: DEFAULT_PASSWORD, name },
      });
    }
    await prisma.user.update({
      where: { email },
      data: { role, emailVerified: true, personId: created.id },
    });
    const seededUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (seededUser) {
      userIdByEmail.set(email, seededUser.id);
    }
    if (role === Role.OPERARIO || role === Role.JEFE_PRODUCCION) {
      fallbackOperatorEmails.push(email);
    }
    for (const spec of specialties) {
      const byProcess = operatorEmailsByProcess.get(spec.process) ?? [];
      if (!byProcess.includes(email)) byProcess.push(email);
      operatorEmailsByProcess.set(spec.process, byProcess);
    }
    console.log(`  ${personData.iniciales} → ${email} (${role})`);
  }

  console.log("Seeding holidays...");
  await prisma.holiday.deleteMany({});
  for (const [iso, name] of HOLIDAYS_2026) {
    const d = new Date(`${iso}T00:00:00.000Z`);
    await prisma.holiday.create({
      data: {
        startDate: d,
        endDate: d,
        name,
        region: "Silla 46460",
      },
    });
  }

  console.log("Seeding admin user...");
  const existing = await prisma.user.findUnique({
    where: { email: "admin@coverdec.local" },
  });
  if (!existing) {
    await auth.api.signUpEmail({
      body: {
        email: "admin@coverdec.local",
        password: "admin12345",
        name: "Administrador",
      },
    });
  }
  await prisma.user.update({
    where: { email: "admin@coverdec.local" },
    data: { role: Role.ADMIN, emailVerified: true },
  });

  console.log("Seeding time entries...");
  await prisma.timeEntry.deleteMany({
    where: { notes: { startsWith: SEEDED_TIME_ENTRY_PREFIX } },
  });
  const candidateTasks = await prisma.task.findMany({
    where: {
      pendingHours: { gt: 0 },
    },
    include: {
      project: { select: { code: true, name: true } },
      lamp: { select: { name: true } },
    },
    orderBy: [{ createdAt: "asc" }, { order: "asc" }],
    take: 10,
  });
  const processRoundRobin = new Map<string, number>();
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);
  for (let i = 0; i < candidateTasks.length; i += 1) {
    const task = candidateTasks[i];
    const processEmails = operatorEmailsByProcess.get(task.process);
    const eligibleEmails =
      processEmails && processEmails.length > 0
        ? processEmails
        : fallbackOperatorEmails;
    if (eligibleEmails.length === 0) continue;
    const rr = processRoundRobin.get(task.process) ?? 0;
    const email = eligibleEmails[rr % eligibleEmails.length];
    processRoundRobin.set(task.process, rr + 1);
    const userId = userIdByEmail.get(email);
    if (!userId) continue;
    const hours = Number(Math.min(task.pendingHours, 2 + (i % 2)).toFixed(2));
    const dayOffset = i % 4;
    const startedAt = new Date(todayUtc);
    startedAt.setUTCDate(todayUtc.getUTCDate() - dayOffset);
    startedAt.setUTCHours(8 + ((i % 3) * 3), 0, 0, 0);
    const endedAt = new Date(startedAt.getTime() + hours * 3600000);
    await prisma.timeEntry.create({
      data: {
        userId,
        projectId: task.projectId,
        lampId: task.lampId,
        taskId: task.id,
        process: task.process,
        source: TimeEntrySource.MANUAL,
        startedAt,
        endedAt,
        hours,
        notes: `${SEEDED_TIME_ENTRY_PREFIX} ${task.project.code} · ${task.lamp.name} · ${task.process}`,
      },
    });
  }

  console.log("Done.");
  console.log("");
  console.log("Usuarios creados:");
  console.log("  admin@coverdec.local   / admin12345  (ADMIN)");
  for (const p of PEOPLE) {
    console.log(`  ${p.email.padEnd(28)} / ${DEFAULT_PASSWORD}  (${p.role})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
