import { prisma } from "@/lib/db";
import { syncTransportTasksForLamp } from "@/features/projects/transport-tasks";

async function main() {
  const lamps = await prisma.lamp.findMany({
    where: { tasks: { some: {} } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  console.log(`Syncing transport tasks for ${lamps.length} lamps...`);

  for (const lamp of lamps) {
    await prisma.$transaction(async (tx) => {
      await syncTransportTasksForLamp(tx, lamp.id);
    });
    console.log(`  ✓ ${lamp.name}`);
  }

  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
