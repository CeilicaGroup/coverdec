import { WorkOrderStatus } from "@/generated/prisma";
import { deleteEmptyOpenWorkOrders } from "@/features/work-orders/cleanup-empty";
import { prisma } from "@/lib/db";

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL no está definido. Carga el entorno antes de ejecutar el script.",
    );
  }

  const dryRun = hasFlag("--dry-run");

  const openWorkOrders = await prisma.workOrder.findMany({
    where: { status: WorkOrderStatus.OPEN },
    select: {
      id: true,
      number: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { number: "asc" },
  });

  const emptyOpenOrders = openWorkOrders.filter((order) => order._count.tasks === 0);

  if (emptyOpenOrders.length === 0) {
    console.log("No hay OTs abiertas vacias para limpiar.");
    return;
  }

  console.log(`OTs abiertas vacias detectadas: ${emptyOpenOrders.length}`);
  for (const order of emptyOpenOrders) {
    console.log(` - ${order.number} (${order.id})`);
  }

  if (dryRun) {
    console.log("Dry-run: no se ha eliminado ninguna OT.");
    return;
  }

  const deleted = await prisma.$transaction(async (tx) =>
    deleteEmptyOpenWorkOrders(
      tx,
      emptyOpenOrders.map((order) => order.id),
    ),
  );

  console.log(`OTs abiertas vacias eliminadas: ${deleted}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
