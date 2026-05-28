import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth-server";
import { resolvePostLoginPath } from "@/lib/dashboard-path";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ path: "/login" });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (!user) {
    return NextResponse.json({ path: "/login" });
  }

  const redirectParam = new URL(request.url).searchParams.get("redirect");
  return NextResponse.json({
    path: resolvePostLoginPath(user.role, redirectParam),
  });
}
