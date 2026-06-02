import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { prisma } from "@/lib/db";

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
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
