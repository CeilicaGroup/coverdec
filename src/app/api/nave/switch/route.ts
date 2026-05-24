import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth-server";

const schema = z.object({ naveId: z.string().min(1) });

export async function POST(request: Request) {
  const session = await requireSession();
  const body = schema.parse(await request.json());

  const nave = await prisma.nave.findUnique({
    where: { id: body.naveId, isActive: true },
  });
  if (!nave) {
    return NextResponse.json({ error: "NAVE_NOT_FOUND" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeNaveId: body.naveId },
  });

  return NextResponse.json({ ok: true });
}
