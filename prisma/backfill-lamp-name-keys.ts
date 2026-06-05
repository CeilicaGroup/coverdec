import { PrismaClient } from "../src/generated/prisma";
import { normalizeLampName } from "../src/features/projects/lamp-name-validation";

const prisma = new PrismaClient();

async function main() {
  const lamps = await prisma.lamp.findMany({
    select: { id: true, projectId: true, name: true, nameKey: true },
    orderBy: { createdAt: "asc" },
  });

  const usedKeysByProject = new Map<string, Set<string>>();

  for (const lamp of lamps) {
    const used = usedKeysByProject.get(lamp.projectId) ?? new Set<string>();
    let nameKey = lamp.nameKey || normalizeLampName(lamp.name);
    if (!nameKey) {
      nameKey = `lamp-${lamp.id.slice(-6)}`;
    }

    let candidate = nameKey;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${nameKey}-${suffix}`;
      suffix += 1;
    }

    used.add(candidate);
    usedKeysByProject.set(lamp.projectId, used);

    if (candidate !== lamp.nameKey) {
      await prisma.lamp.update({
        where: { id: lamp.id },
        data: { nameKey: candidate },
      });
    }
  }

  console.log(`Backfilled nameKey for ${lamps.length} lamps`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
