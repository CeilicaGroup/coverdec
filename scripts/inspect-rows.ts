import ExcelJS from "exceljs";
import { readString, readNumber } from "../src/lib/excel/cell";

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile("docs/PRODUCCION.xlsx");
  const sheet = wb.getWorksheet("🗂️ Proyectos");
  if (!sheet) throw new Error("Missing");
  for (const r of [2, 3, 100, 240, 245, 250]) {
    const row = sheet.getRow(r);
    const cells: Record<number, unknown> = {};
    for (let c = 1; c <= 12; c++) {
      cells[c] = readString(row.getCell(c).value);
    }
    console.log(`row ${r}:`, cells);
  }

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile("docs/FABRICA.xlsx");
  const sheet2 = wb2.getWorksheet("FABRICA 2026");
  if (!sheet2) throw new Error("Missing fabrica");
  for (let r = 1; r <= 8; r++) {
    const row = sheet2.getRow(r);
    const cells: Record<number, unknown> = {};
    for (let c = 1; c <= 20; c++) {
      cells[c] = readString(row.getCell(c).value);
    }
    console.log(`FABRICA row ${r}:`, cells);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
