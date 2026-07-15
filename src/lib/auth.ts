import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { AuditOutcome, Role } from "@/generated/prisma";
import { devUserSwitchAuthPlugin } from "@/lib/dev-user-switch-auth-plugin";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit/record-audit-event";

function requestMetaFromAuthContext(ctx: {
  request?: Request;
  headers?: Headers;
}) {
  const headers = ctx.request?.headers ?? ctx.headers;
  return {
    ipAddress:
      headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? headers?.get("x-real-ip")
      ?? null,
    userAgent: headers?.get("user-agent") ?? null,
  };
}

export const auth = betterAuth({
  appName: "CoverDec",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      personId: { type: "string", input: false, required: false },
      activeNaveId: { type: "string", input: false, required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  trustedOrigins: process.env.BETTER_AUTH_URL
    ? [process.env.BETTER_AUTH_URL]
    : [],
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const path = ctx.path;
      const requestMeta = requestMetaFromAuthContext(ctx);

      if (path === "/sign-in/email" && ctx.context.newSession?.user) {
        const user = ctx.context.newSession.user;
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, activeNaveId: true, name: true, email: true },
        });
        await recordAuditEvent({
          action: "auth.signIn",
          category: "auth",
          outcome: AuditOutcome.SUCCESS,
          summary: "Inicio de sesión",
          actor: dbUser
            ? {
                userId: user.id,
                role: dbUser.role,
                name: dbUser.name,
                email: dbUser.email,
                naveId: dbUser.activeNaveId,
              }
            : {
                userId: user.id,
                role: Role.OPERARIO,
                name: user.name,
                email: user.email,
                naveId: null,
              },
          request: requestMeta,
          entityType: "User",
          entityId: user.id,
        });
        return;
      }

      if (
        path === "/sign-in/email"
        && ctx.context.returned
        && typeof ctx.context.returned === "object"
        && ctx.context.returned !== null
        && "error" in ctx.context.returned
      ) {
        await recordAuditEvent({
          action: "auth.signIn",
          category: "auth",
          outcome: AuditOutcome.FAILURE,
          summary: "Intento de inicio de sesión fallido",
          request: requestMeta,
        });
        return;
      }

      if (path === "/sign-out" && ctx.context.session?.user) {
        const user = ctx.context.session.user;
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true, activeNaveId: true, name: true, email: true },
        });
        await recordAuditEvent({
          action: "auth.signOut",
          category: "auth",
          outcome: AuditOutcome.SUCCESS,
          summary: "Cierre de sesión",
          actor: dbUser
            ? {
                userId: user.id,
                role: dbUser.role,
                name: dbUser.name,
                email: dbUser.email,
                naveId: dbUser.activeNaveId,
              }
            : {
                userId: user.id,
                role: Role.OPERARIO,
                name: user.name,
                email: user.email,
                naveId: null,
              },
          request: requestMeta,
          entityType: "User",
          entityId: user.id,
        });
      }
    }),
  },
  plugins: [
    admin({
      defaultRole: "OPERARIO",
      adminRoles: ["ADMIN"],
      roles: {
        ADMIN: adminAc,
        JEFE_PRODUCCION: userAc,
        OPERARIO: userAc,
      },
    }),
    devUserSwitchAuthPlugin(),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
