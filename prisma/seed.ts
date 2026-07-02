import { ElementTypology, PrismaClient, ProjectKind, Role } from "../src/generated/prisma";
import { auth } from "../src/lib/auth";
import { defaultWeeklyTemplate } from "../src/features/planning/engine/slots/person-schedule";
import {
  buildTasksFromElement,
  formatLampElementUnitLabel,
} from "../src/features/projects/lamp-tasks";
import { lampNameFields } from "../src/features/projects/lamp-name-validation";

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
  { code: "TRANSPORTE",   label: "Transporte",        factor: 1,    setupHours: 0.5, waitHours: 0, bgColor: "#FEF3C7", fgColor: "#92400E", borderColor: "#D97706" },
  { code: "IMPREVISTA",   label: "Imprevista",        factor: 1,    setupHours: 0,   waitHours: 0, bgColor: "#FCE7F3", fgColor: "#9D174D", borderColor: "#BE185D" },
  { code: "ESTIMACION_MANUAL", label: "Estimación manual", factor: 1, setupHours: 0, waitHours: 0, bgColor: "#F3F4F6", fgColor: "#374151", borderColor: "#374151" },
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
      { process: "TRANSPORTE", isFallback: true },
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
      { process: "TRANSPORTE", isFallback: true },
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
      { process: "TRANSPORTE", isFallback: true },
    ],
    notes: "Operador CNC principal. John opera CNC solo si Daniil ausente.",
  },
];

const ELEMENT_TYPES = [
  {
    code: "TELA",
    name: "Panel de tela",
    typology: ElementTypology.TELA,
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
    typology: ElementTypology.BASTIDOR,
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
    typology: ElementTypology.BASTIDOR,
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
    typology: ElementTypology.ILUMINACION,
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
    typology: ElementTypology.ILUMINACION,
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
      { name: "Panel tela fachada", elementTypeCode: "TELA",      surfaceM2: 4.5, units: 2 },
      { name: "Composite lateral",  elementTypeCode: "COMPOSITE",  surfaceM2: 2.0, units: 1 },
      { name: "Hair espejo caja",   elementTypeCode: "HAIR",       surfaceM2: 1.5, units: 1 },
    ],
  },
  {
    code: "druni-cc-baricentro",
    name: "DRUNI CC Baricentro",
    client: "DRUNI",
    deliveryDate: new Date("2026-08-01T00:00:00.000Z"),
    lamps: [
      { name: "Panel espumado frontal", elementTypeCode: "ESPUMADO",  surfaceM2: 5.0, units: 2 },
      { name: "Composite mostrador",    elementTypeCode: "COMPOSITE",  surfaceM2: 1.8, units: 2 },
    ],
  },
  {
    code: "druni-cc-mn4",
    name: "DRUNI CC MN4",
    client: "DRUNI",
    deliveryDate: new Date("2026-08-20T00:00:00.000Z"),
    lamps: [
      { name: "Tela fachada principal", elementTypeCode: "TELA",      surfaceM2: 6.0, units: 1 },
      { name: "Hair lateral",           elementTypeCode: "HAIR",       surfaceM2: 2.0, units: 2 },
    ],
  },
  {
    code: "druni-cc-las-arenas",
    name: "DRUNI CC Las Arenas",
    client: "DRUNI",
    deliveryDate: new Date("2026-09-05T00:00:00.000Z"),
    lamps: [
      { name: "Espumado cabecera",    elementTypeCode: "ESPUMADO",  surfaceM2: 4.0, units: 1 },
      { name: "Composite zócalo",     elementTypeCode: "COMPOSITE",  surfaceM2: 3.0, units: 1 },
      { name: "Sol decorativo",       elementTypeCode: "SOL",        surfaceM2: 1.2, units: 3 },
    ],
  },
  {
    code: "druni-marbella",
    name: "DRUNI Marbella",
    client: "DRUNI",
    deliveryDate: new Date("2026-09-30T00:00:00.000Z"),
    lamps: [
      { name: "Tela fachada",     elementTypeCode: "TELA",      surfaceM2: 5.5, units: 1 },
      { name: "Hair espejo",      elementTypeCode: "HAIR",       surfaceM2: 1.8, units: 2 },
    ],
  },
  {
    code: "arenal-cc-el-rosal",
    name: "ARENAL CC El Rosal",
    client: "ARENAL",
    deliveryDate: new Date("2026-10-15T00:00:00.000Z"),
    lamps: [
      { name: "Espumado frontal",    elementTypeCode: "ESPUMADO",  surfaceM2: 7.0, units: 1 },
      { name: "Sol entrada",         elementTypeCode: "SOL",        surfaceM2: 1.5, units: 2 },
    ],
  },
  {
    code: "byd-barcelona",
    name: "BYD Barcelona",
    client: "BYD",
    deliveryDate: new Date("2026-11-01T00:00:00.000Z"),
    lamps: [
      { name: "Espumado showroom",   elementTypeCode: "ESPUMADO",  surfaceM2: 6.0, units: 1 },
      { name: "Composite columna",   elementTypeCode: "COMPOSITE",  surfaceM2: 3.0, units: 2 },
    ],
  },
  {
    code: "punto-valencia",
    name: "PUNTO Valencia",
    client: "PUNTO",
    deliveryDate: new Date("2026-11-20T00:00:00.000Z"),
    lamps: [
      { name: "Tela escaparate",  elementTypeCode: "TELA",      surfaceM2: 3.5, units: 2 },
      { name: "Hair elemento",    elementTypeCode: "HAIR",       surfaceM2: 1.2, units: 1 },
      { name: "Sol decorativo",   elementTypeCode: "SOL",        surfaceM2: 0.8, units: 4 },
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

type SeedLampInput = {
  name: string;
  elementTypeCode: string;
  surfaceM2: number;
  units: number;
};

async function seedLampWithTasks(
  projectId: string,
  lamp: SeedLampInput,
  elementType: { id: string; name: string },
  naveId: string,
  existingLampId?: string,
) {
  const blueprints = await buildTasksFromElement(elementType.id, lamp.surfaceM2);
  if (blueprints.length === 0) return;

  await prisma.$transaction(async (tx) => {
    const created = existingLampId
      ? await tx.lamp.findUniqueOrThrow({ where: { id: existingLampId } })
      : await tx.lamp.create({
          data: {
            projectId,
            elementTypeId: elementType.id,
            ...lampNameFields(lamp.name),
            surfaceM2: lamp.surfaceM2,
            units: lamp.units,
          },
        });

    let physicalElementIndex = 0;

    for (let unitIndex = 1; unitIndex <= lamp.units; unitIndex += 1) {
      const label = formatLampElementUnitLabel(
        elementType.name,
        unitIndex,
        lamp.units,
      );

      let lampElement = await tx.lampElement.findFirst({
        where: { lampId: created.id, elementTypeId: elementType.id, label },
      });
      if (!lampElement) {
        lampElement = await tx.lampElement.create({
          data: {
            lampId: created.id,
            elementTypeId: elementType.id,
            label,
            surfaceM2: lamp.surfaceM2,
            units: 1,
          },
        });
      }

      const existingTaskCount = await tx.task.count({
        where: { lampElementId: lampElement.id },
      });
      if (existingTaskCount > 0) {
        physicalElementIndex += 1;
        continue;
      }

      await tx.task.createMany({
        data: blueprints.map((bp) => ({
          projectId,
          lampId: created.id,
          lampElementId: lampElement.id,
          process: bp.process,
          estimatedHours: bp.estimatedHours,
          order: bp.order + physicalElementIndex * 1000,
          naveId,
        })),
      });

      physicalElementIndex += 1;
    }
  });
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
  const naveByCodigo = new Map(
    (
      await prisma.nave.findMany({
        orderBy: { codigo: "asc" },
        select: { id: true, codigo: true },
      })
    ).map((nave) => [nave.codigo, nave.id]),
  );
  const firstNave = await prisma.nave.findFirstOrThrow({ orderBy: { codigo: "asc" } });

  console.log("Seeding typology default naves...");
  const typologyNaveByCodigo: Array<{
    typology: ElementTypology;
    codigo: string;
  }> = [
    { typology: ElementTypology.TELA, codigo: "N1" },
    { typology: ElementTypology.BASTIDOR, codigo: "N1" },
    { typology: ElementTypology.ILUMINACION, codigo: "N2" },
  ];
  for (const row of typologyNaveByCodigo) {
    const naveId = naveByCodigo.get(row.codigo);
    if (!naveId) continue;
    await prisma.elementTypologyNave.upsert({
      where: { typology: row.typology },
      update: { defaultNaveId: naveId },
      create: { typology: row.typology, defaultNaveId: naveId },
    });
  }

  console.log("Seeding element types...");
  const elementTypeByCode = new Map<string, { id: string; name: string }>();
  for (const et of ELEMENT_TYPES) {
    const { processes, ...etData } = et;
    const created = await prisma.elementType.upsert({
      where: { code: etData.code },
      update: {
        name: etData.name,
        description: etData.description,
        typology: etData.typology,
        defaultNaveId: null,
      },
      create: { ...etData, defaultNaveId: null },
    });
    elementTypeByCode.set(etData.code, created);
    for (const ep of processes) {
      await prisma.elementTypeProcess.upsert({
        where: { elementTypeId_process: { elementTypeId: created.id, process: ep.process } },
        update: { hoursPerUnit: ep.hoursPerUnit, fixedHours: ep.fixedHours, sequence: ep.sequence },
        create: { elementTypeId: created.id, ...ep },
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
      const elementType = elementTypeByCode.get(lamp.elementTypeCode);
      if (!elementType) continue;
      const exists = await prisma.lamp.findFirst({
        where: { projectId: project.id, name: lamp.name },
      });
      if (exists) {
        const taskCount = await prisma.task.count({ where: { lampId: exists.id } });
        if (taskCount > 0) continue;
        await seedLampWithTasks(
          project.id,
          lamp,
          elementType,
          firstNave.id,
          exists.id,
        );
        continue;
      }
      await seedLampWithTasks(project.id, lamp, elementType, firstNave.id);
    }
    console.log(`  ${project.name} (${lamps.length} lámparas)`);
  }

  console.log("Seeding people...");
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

  await prisma.project.upsert({
    where: { code: "STOCK-POOL" },
    update: {
      name: "Pool de stock",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.STOCK,
    },
    create: {
      code: "STOCK-POOL",
      name: "Pool de stock",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.STOCK,
    },
  });

  const imprevistasPool = await prisma.project.upsert({
    where: { code: "IMPREVISTAS-POOL" },
    update: {
      name: "Pool de imprevistas",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.IMPREVISTAS,
    },
    create: {
      code: "IMPREVISTAS-POOL",
      name: "Pool de imprevistas",
      isBillable: false,
      isActive: true,
      kind: ProjectKind.IMPREVISTAS,
    },
  });

  await prisma.lamp.upsert({
    where: {
      projectId_nameKey: {
        projectId: imprevistasPool.id,
        nameKey: "imprevistas",
      },
    },
    update: { name: "Imprevistas" },
    create: {
      projectId: imprevistasPool.id,
      name: "Imprevistas",
      nameKey: "imprevistas",
      units: 1,
    },
  });

  await prisma.timeDeviationPolicy.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      deviationThresholdPct: 15,
      movingAverageSamples: 10,
    },
    update: {},
  });

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
