import { z } from "zod";
import { NextResponse } from "next/server";
import { AuditOutcome, Role } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { recordApiAudit } from "@/lib/audit/record-api-audit";
import { requireSession } from "@/lib/auth-server";
import { personNaveIds } from "@/features/people/person-naves";

const schema = z.object({ naveId: z.string() });

export async function POST(request: Request) {
  const session = await requireSession();
  const body = schema.parse(await request.json());

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, person: { select: { personNaves: { select: { naveId: true } } } } },
  });
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!body.naveId) {
    if (user.role !== Role.ADMIN) {
      return NextResponse.json({ error: "NAVE_REQUIRED" }, { status: 403 });
    }
    await prisma.user.update({
      where: { id: session.user.id },
      data: { activeNaveId: null },
    });
    void recordApiAudit(
      "api.nave.switch",
      request,
      AuditOutcome.SUCCESS,
      "Cambiar a vista global (todas las naves)",
      { metadata: { naveId: null } },
    );
    return NextResponse.json({ ok: true });
  }

  const nave = await prisma.nave.findUnique({
    where: { id: body.naveId, isActive: true },
  });
  if (!nave) {
    return NextResponse.json({ error: "NAVE_NOT_FOUND" }, { status: 404 });
  }

  if (user.role === Role.OPERARIO) {
    const allowed = personNaveIds(user.person);
    if (!allowed.includes(body.naveId)) {
      return NextResponse.json({ error: "NAVE_NOT_ALLOWED" }, { status: 403 });
    }
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { activeNaveId: body.naveId },
  });

  void recordApiAudit(
    "api.nave.switch",
    request,
    AuditOutcome.SUCCESS,
    `Cambiar nave activa`,
    { metadata: { naveId: body.naveId, naveCodigo: nave.codigo } },
  );

  return NextResponse.json({ ok: true });
}
