/** QA-only user switcher; never enabled in production. */
export function isDevUserSwitcherEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_DEV_USER_SWITCHER === "true"
  );
}

/** Seed users can use passwords other than DEV_USER_SWITCH_PASSWORD. */
const SEED_DEV_PASSWORD_BY_EMAIL: Record<string, string> = {
  "admin@coverdec.local": "admin12345",
};

export function resolveDevPasswordCandidates(email: string): string[] {
  const defaultPassword = getDevUserSwitchPassword();
  if (!defaultPassword) return [];

  const normalizedEmail = email.trim().toLowerCase();
  const override = SEED_DEV_PASSWORD_BY_EMAIL[normalizedEmail];
  const candidates = override
    ? override === defaultPassword
      ? [defaultPassword]
      : [override, defaultPassword]
    : [defaultPassword];

  return [...new Set(candidates)];
}

export function getDevUserSwitchPassword(): string | null {
  const password = process.env.DEV_USER_SWITCH_PASSWORD?.trim();
  return password || null;
}

export function assertDevUserSwitcherEnabled(): void {
  if (!isDevUserSwitcherEnabled()) {
    throw new Error("El conmutador de usuario no está disponible.");
  }
}

export function requireDevUserSwitchPassword(): string {
  assertDevUserSwitcherEnabled();
  const password = getDevUserSwitchPassword();
  if (!password) {
    throw new Error(
      "Falta DEV_USER_SWITCH_PASSWORD en el entorno para usar el conmutador de usuario.",
    );
  }
  return password;
}
