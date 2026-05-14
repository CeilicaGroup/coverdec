import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth-server";

const schema = z.object({ empresaId: z.string().min(1) });

export async function POST(request: Request) {
  const session = await requireSession();
  const body = schema.parse(await request.json());

  const membership = await prisma.membership.findUnique({
    where: {
      userId_empresaId: { userId: session.user.id, empresaId: body.empresaId },
    },
  });
  if (!membership) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeEmpresaId: body.empresaId },
  });

  return NextResponse.json({ ok: true });
}
