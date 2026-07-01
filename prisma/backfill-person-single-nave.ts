import { PrismaClient } from "../src/generated/prisma";

const prisma = new PrismaClient();

async function main() {
  const people = await prisma.person.findMany({
    select: {
      id: true,
      iniciales: true,
      personNaves: {
        include: { nave: { select: { id: true, codigo: true } } },
        orderBy: { nave: { codigo: "asc" } },
      },
    },
  });

  let affectedPeople = 0;
  let removedRows = 0;

  for (const person of people) {
    if (person.personNaves.length <= 1) continue;

    const keep = person.personNaves[0]!;
    const removeIds = person.personNaves.slice(1).map((pn) => pn.naveId);

    await prisma.personNave.deleteMany({
      where: {
        personId: person.id,
        naveId: { in: removeIds },
      },
    });

    affectedPeople += 1;
    removedRows += removeIds.length;

    console.log(
      `Person ${person.iniciales} (${person.id}): kept nave ${keep.nave.codigo}, removed ${removeIds.length}`,
    );
  }

  console.log(
    `Backfill complete: ${affectedPeople} people adjusted, ${removedRows} PersonNave rows removed`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
