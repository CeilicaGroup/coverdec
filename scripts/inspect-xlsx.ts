import ExcelJS from "exceljs";
import path from "node:path";

async function inspect(file: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  console.log("==", path.basename(file));
  for (const ws of wb.worksheets) {
    console.log(
      `-- ${ws.name} (state=${ws.state}, rows=${ws.rowCount}, cols=${ws.columnCount})`,
    );
    for (let i = 1; i <= Math.min(3, ws.rowCount); i++) {
      const row = ws.getRow(i).values as unknown[];
      console.log(`  row${i}:`, row.slice(0, 25));
    }
  }
}

async function main() {
  await inspect(path.resolve(process.cwd(), "docs/PRODUCCION.xlsx"));
  await inspect(path.resolve(process.cwd(), "docs/FABRICA.xlsx"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
