import { NextResponse } from "next/server";
import { z } from "zod";
import { Role } from "@/generated/prisma";
import { requireDashboardContext, requireRole } from "@/lib/context";
import { childLogger } from "@/lib/logger";
import { buildPlatformExportWorkbook } from "@/features/admin/export-platform";

const log = childLogger({ module: "api.admin.export" });
const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function parseUtcStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function parseUtcEnd(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

function normalizeDateParam(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireDashboardContext();
    requireRole(ctx, [Role.ADMIN]);
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      from: normalizeDateParam(url.searchParams.get("from")),
      to: normalizeDateParam(url.searchParams.get("to")),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_DATES" }, { status: 400 });
    }
    const fromDate = parsed.data.from ? parseUtcStart(parsed.data.from) : undefined;
    const toDate = parsed.data.to ? parseUtcEnd(parsed.data.to) : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      return NextResponse.json({ error: "INVALID_DATE_RANGE" }, { status: 400 });
    }

    const { buffer, filename } = await buildPlatformExportWorkbook({
      from: fromDate,
      to: toDate,
    });
    const bytes = new Uint8Array(buffer);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }
    log.error({ error }, "failed to export platform workbook");
    return NextResponse.json({ error: "EXPORT_FAILED" }, { status: 500 });
  }
}
