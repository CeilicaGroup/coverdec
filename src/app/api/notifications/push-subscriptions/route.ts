import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/auth-server";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export async function POST(request: Request) {
  const session = await requireSession();
  const data = subscriptionSchema.parse(await request.json());

  await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    create: {
      userId: session.user.id,
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
      expirationTime: data.expirationTime ? new Date(data.expirationTime) : null,
      isActive: true,
    },
    update: {
      userId: session.user.id,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
      expirationTime: data.expirationTime ? new Date(data.expirationTime) : null,
      isActive: true,
    },
  });

  return NextResponse.json({ ok: true });
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
});

export async function DELETE(request: Request) {
  const session = await requireSession();
  const data = unsubscribeSchema.parse(await request.json());

  await prisma.pushSubscription.updateMany({
    where: { endpoint: data.endpoint, userId: session.user.id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
