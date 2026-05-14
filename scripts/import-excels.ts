import path from "node:path";
import { prisma } from "../src/lib/db";
import { importProduccion } from "../src/features/imports/produccion";
import { importFabrica } from "../src/features/imports/fabrica";

async function main() {
  const empresa = await prisma.empresa.findUniqueOrThrow({
    where: { razonSocial: "Coverdec Innovación SL" },
  });

  const produccionPath = path.resolve(
    process.cwd(),
    "docs/PRODUCCION.xlsx",
  );
  const fabricaPath = path.resolve(process.cwd(), "docs/FABRICA.xlsx");

  const produccionSummary = await importProduccion({
    filePath: produccionPath,
    empresaId: empresa.id,
  });
  console.log("PRODUCCION summary:", produccionSummary);

  const fabricaSummary = await importFabrica({
    filePath: fabricaPath,
    empresaId: empresa.id,
  });
  console.log("FABRICA summary:", fabricaSummary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
