import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ElementTypology } from "@/generated/prisma";

const TYPOLOGY_VALUES = new Set<string>(Object.values(ElementTypology));

export async function GET(
  _request: Request,
  context: { params: Promise<{ typology: string }> },
) {
  const { typology } = await context.params;
  if (!TYPOLOGY_VALUES.has(typology)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const row = await prisma.elementTypologyNave.findUnique({
    where: { typology: typology as ElementTypology },
    select: { imageData: true, imageMimeType: true, imageUpdatedAt: true },
  });

  if (!row?.imageData || !row.imageMimeType) {
    return new NextResponse("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": row.imageMimeType,
    "Cache-Control": "private, max-age=3600",
  });
  if (row.imageUpdatedAt) {
    headers.set("Last-Modified", row.imageUpdatedAt.toUTCString());
  }

  return new NextResponse(row.imageData, { status: 200, headers });
}
