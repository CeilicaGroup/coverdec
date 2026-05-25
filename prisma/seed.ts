import { PrismaClient, Role } from "../src/generated/prisma";
import { auth } from "../src/lib/auth";
import { defaultWeeklyTemplate } from "../src/features/planning/engine/slots/person-schedule";

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
    nombre: "Claudio Peralta",
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
    nombre: "Serhii Kotluienko",
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
    nombre: "Ihor Alieksieiev",
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
    nombre: "Tetiana Mesriakin",
    alias: "Tetiana",
    iniciales: "TM",
    color: "#7C3AED",
    email: "tetiana@coverdec.local",
    role: Role.OPERARIO,
    specialties: [{ process: "LIJADO", isPrimary: true }],
    notes: "Especialista lijado y masillado.",
  },
  {
    nombre: "Daniil Shcheglov",
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

  console.log("Seeding people...");
  for (const person of PEOPLE) {
    const { specialties, email, role, ...data } = person;
    const personData = { ...data, naveId: firstNave.id };
    const created = await prisma.person.upsert({
      where: { iniciales: data.iniciales },
      update: personData,
      create: personData,
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
        body: { email, password: DEFAULT_PASSWORD, name: data.nombre },
      });
    }
    await prisma.user.update({
      where: { email },
      data: { role, emailVerified: true, personId: created.id },
    });
    console.log(`  ${data.iniciales} → ${email} (${role})`);
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
