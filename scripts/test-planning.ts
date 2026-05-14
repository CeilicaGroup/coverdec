import { prisma } from "../src/lib/db";
import { generatePlanning } from "../src/features/planning/service";

async function main() {
  const empresa = await prisma.empresa.findFirstOrThrow();
  const result = await generatePlanning({
    empresaId: empresa.id,
    weekStart: new Date("2026-05-04T00:00:00Z"),
  });
  console.log("planning:", JSON.stringify(result, null, 2).slice(0, 1200));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
