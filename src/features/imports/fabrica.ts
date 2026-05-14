import ExcelJS from "exceljs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { childLogger } from "@/lib/logger";
import { readDate, readNumber, readString } from "@/lib/excel/cell";
import { FactoryStatus } from "@/generated/prisma";

const log = childLogger({ module: "import.fabrica" });

const argsSchema = z.object({
  filePath: z.string().min(1),
  empresaId: z.string().min(1),
});

export interface FabricaSummary {
  items: { created: number; updated: number; skipped: number };
  warnings: string[];
}

const STATUS_MAP: Record<string, FactoryStatus> = {
  DOSSIER: FactoryStatus.DOSSIER,
  PRODUCCION: FactoryStatus.PRODUCCION,
  "EN PRODUCCION": FactoryStatus.PRODUCCION,
  "CONTROL CALIDAD": FactoryStatus.CONTROL_CALIDAD,
  EMBALAJE: FactoryStatus.EMBALAJE,
  ENVIADO: FactoryStatus.ENVIADO,
};

const normalize = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

function mapStatus(raw: string | null): FactoryStatus {
  if (!raw) return FactoryStatus.DOSSIER;
  const key = normalize(raw);
  return STATUS_MAP[key] ?? FactoryStatus.DOSSIER;
}

export async function importFabrica(args: {
  filePath: string;
  empresaId: string;
}): Promise<FabricaSummary> {
  const { filePath, empresaId } = argsSchema.parse(args);
  const summary: FabricaSummary = {
    items: { created: 0, updated: 0, skipped: 0 },
    warnings: [],
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("FABRICA 2026");
  if (!sheet) {
    summary.warnings.push("Hoja FABRICA 2026 no encontrada");
    return summary;
  }

  // FABRICA header row 3: B=ESTADO, C=DESCRIPCION, E=PROYECTO, F=PRODUCTO,
  // G=MEDICION, H=CANTIDAD, I=NAVE, J=FECHA, K=DIAS, L=ESTADO, M=COMENTARIOS, N=CODIGO
  let headerRow = 0;
  for (let r = 1; r <= 10; r++) {
    const text = readString(sheet.getRow(r).getCell(2).value);
    if (text && text.toUpperCase() === "ESTADO") {
      headerRow = r;
      break;
    }
  }
  if (headerRow === 0) {
    summary.warnings.push("Cabecera FABRICA no encontrada");
    return summary;
  }

  log.info({ filePath, empresaId, headerRow }, "fabrica import start");

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const proyecto = readString(row.getCell(5).value);
    const producto = readString(row.getCell(6).value);
    const medicion = readNumber(row.getCell(7).value);
    const cantidad = readNumber(row.getCell(8).value);
    const nave = readString(row.getCell(9).value);
    const fecha = readDate(row.getCell(10).value);
    const estadoRaw =
      readString(row.getCell(12).value) ?? readString(row.getCell(2).value);
    const comentarios = readString(row.getCell(13).value);
    const codigo = readString(row.getCell(14).value);

    if (!producto && !proyecto && !codigo) {
      summary.items.skipped += 1;
      continue;
    }

    const status = mapStatus(estadoRaw);
    const productName = producto ?? proyecto ?? codigo ?? "Sin nombre";
    const notesParts: string[] = [];
    if (medicion != null) notesParts.push(`Medición: ${medicion}`);
    if (cantidad != null) notesParts.push(`Cantidad: ${cantidad}`);
    if (comentarios) notesParts.push(comentarios);

    // Deduplicate by stable composite key: code if present, else row index suffix.
    const stableCode = codigo ?? `row-${r}`;
    const existing = await prisma.factoryItem.findFirst({
      where: { empresaId, code: stableCode },
    });

    if (existing) {
      await prisma.factoryItem.update({
        where: { id: existing.id },
        data: {
          status,
          code: stableCode,
          product: productName,
          obra: proyecto ?? existing.obra,
          nave: nave ?? existing.nave,
          scheduledAt: fecha ?? existing.scheduledAt,
          notes: notesParts.join(" · ") || existing.notes,
        },
      });
      summary.items.updated += 1;
    } else {
      await prisma.factoryItem.create({
        data: {
          empresaId,
          code: stableCode,
          product: productName,
          obra: proyecto ?? undefined,
          nave: nave ?? undefined,
          status,
          scheduledAt: fecha ?? undefined,
          notes: notesParts.join(" · ") || undefined,
        },
      });
      summary.items.created += 1;
    }
  }

  log.info({ summary }, "fabrica import done");
  return summary;
}
