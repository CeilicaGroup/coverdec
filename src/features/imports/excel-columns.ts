import type ExcelJS from "exceljs";
import { readString } from "@/lib/excel/cell";
import { readSheetHeaders } from "./excel-workbook";

export function columnIndexToLetter(col: number): string {
  let n = col;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

import type { SheetColumnOption } from "./types";

export type { SheetColumnOption };

function truncateSample(value: string, max = 36): string {
  const t = value.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function buildSheetColumnOptions(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  hints: Partial<Record<number, string>> = {},
): SheetColumnOption[] {
  const headerTexts = readSheetHeaders(sheet, headerRow);
  const sampleRow = sheet.getRow(headerRow + 1);
  const maxCol = Math.max(
    headerTexts.length,
    sheet.columnCount,
    sampleRow.cellCount,
    1,
  );

  const options: SheetColumnOption[] = [];
  for (let c = 1; c <= maxCol; c++) {
    const letter = columnIndexToLetter(c);
    const header = headerTexts[c - 1] ?? `Columna ${c}`;
    const isGenericHeader = /^Columna \d+$/.test(header);
    const sample = readString(sampleRow.getCell(c).value);
    const hint = hints[c];

    let label: string;
    if (hint) {
      label = `${letter} — ${hint}`;
    } else if (!isGenericHeader) {
      label = `${letter} — ${header}`;
    } else if (sample) {
      label = `${letter} — ${truncateSample(sample)}`;
    } else {
      label = `${letter} — Columna ${c}`;
    }

    options.push({ index: c, letter, label });
  }

  while (
    options.length > 0 &&
    options[options.length - 1]!.label.endsWith(
      `— Columna ${options[options.length - 1]!.index}`,
    ) &&
    !hints[options[options.length - 1]!.index]
  ) {
    const last = options[options.length - 1]!;
    const sample = readString(sampleRow.getCell(last.index).value);
    if (sample) break;
    options.pop();
  }

  return options;
}

export function labelForColumnIndex(
  options: SheetColumnOption[],
  index: number | null | undefined,
): string | null {
  if (index == null) return null;
  return options.find((o) => o.index === index)?.label ?? null;
}
