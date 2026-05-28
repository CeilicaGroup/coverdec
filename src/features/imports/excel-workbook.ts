import ExcelJS from "exceljs";
import { readString } from "@/lib/excel/cell";
import {
  readMappedNumberCell,
  readMappedTextCell,
} from "./excel-cell-values";
import type { BastidorFieldKey, ImportFieldKey, ImportMapping } from "./types";
import { IMPORT_MAX_ROWS } from "./types";

const TEXT_FIELDS = new Set<BastidorFieldKey>([
  "frameName",
  "processName",
  "frameCode",
]);

const NUMBER_FIELDS = new Set<BastidorFieldKey>(["hoursPerUnit"]);

export async function loadWorkbookFromBuffer(
  buffer: Buffer,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}

export function listSheetNames(wb: ExcelJS.Workbook): string[] {
  return wb.worksheets.map((s) => s.name);
}

export function getWorksheet(
  wb: ExcelJS.Workbook,
  sheetName: string,
): ExcelJS.Worksheet | undefined {
  return wb.getWorksheet(sheetName) ?? undefined;
}

export function readSheetHeaders(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): string[] {
  const row = sheet.getRow(headerRow);
  const headers: string[] = [];
  const colCount = Math.max(sheet.columnCount, row.cellCount, 1);
  for (let c = 1; c <= colCount; c++) {
    const text = readString(row.getCell(c).value);
    headers.push(text ?? `Columna ${c}`);
  }
  while (headers.length > 0 && headers[headers.length - 1]?.startsWith("Columna ")) {
    const last = headers[headers.length - 1];
    if (last && /^Columna \d+$/.test(last)) headers.pop();
    else break;
  }
  return headers;
}

export interface RawMappedRow {
  rowIndex: number;
  values: Partial<Record<ImportFieldKey, string | number | null>>;
}

function readCellValue(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  col: number | null | undefined,
  field: ImportFieldKey,
): string | number | null {
  if (col == null || col < 1) return null;
  const cell = sheet.getRow(rowIndex).getCell(col).value;
  if (NUMBER_FIELDS.has(field as BastidorFieldKey)) {
    return readMappedNumberCell(cell);
  }
  if (TEXT_FIELDS.has(field as BastidorFieldKey)) {
    return readMappedTextCell(cell);
  }
  return readMappedTextCell(cell);
}

export function extractMappedRows(
  sheet: ExcelJS.Worksheet,
  mapping: ImportMapping,
  maxRows = IMPORT_MAX_ROWS,
): RawMappedRow[] {
  const startRow = mapping.headerRow + 1;
  const endRow = Math.min(sheet.rowCount, startRow + maxRows - 1);
  const rows: RawMappedRow[] = [];

  for (let r = startRow; r <= endRow; r++) {
    const values: Partial<Record<ImportFieldKey, string | number | null>> = {};
    for (const [field, col] of Object.entries(mapping.columnMap)) {
      values[field as ImportFieldKey] = readCellValue(
        sheet,
        r,
        col ?? undefined,
        field as ImportFieldKey,
      );
    }
    const hasData = Object.values(values).some(
      (v) => v != null && String(v).trim() !== "",
    );
    if (!hasData) continue;
    rows.push({ rowIndex: r, values });
  }

  return rows;
}
