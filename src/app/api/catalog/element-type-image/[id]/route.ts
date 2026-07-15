import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const row = await prisma.elementType.findUnique({
    where: { id },
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
