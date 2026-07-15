import { afterEach, describe, expect, it, vi } from "vitest";

describe("isDevUserSwitcherEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadHelper() {
    return import("@/lib/dev-user-switcher");
  }

  it("is enabled in production when flag is true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_USER_SWITCHER", "true");
    const { isDevUserSwitcherEnabled } = await loadHelper();
    expect(isDevUserSwitcherEnabled()).toBe(true);
  });

  it("is disabled in production when flag is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_USER_SWITCHER", "");
    const { isDevUserSwitcherEnabled } = await loadHelper();
    expect(isDevUserSwitcherEnabled()).toBe(false);
  });

  it("is enabled in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_DEV_USER_SWITCHER", "");
    const { isDevUserSwitcherEnabled } = await loadHelper();
    expect(isDevUserSwitcherEnabled()).toBe(true);
  });

  it("is enabled outside development when flag is true", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_DEV_USER_SWITCHER", "true");
    const { isDevUserSwitcherEnabled } = await loadHelper();
    expect(isDevUserSwitcherEnabled()).toBe(true);
  });

  it("is disabled outside development when flag is absent", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ENABLE_DEV_USER_SWITCHER", "");
    const { isDevUserSwitcherEnabled } = await loadHelper();
    expect(isDevUserSwitcherEnabled()).toBe(false);
  });
});

describe("requireDevUserSwitchPassword", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws when password env is missing", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_USER_SWITCH_PASSWORD", "");
    const { requireDevUserSwitchPassword } = await import("@/lib/dev-user-switcher");
    expect(() => requireDevUserSwitchPassword()).toThrow(
      "Falta DEV_USER_SWITCH_PASSWORD",
    );
  });

  it("returns trimmed password when configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_USER_SWITCH_PASSWORD", "  coverdec123  ");
    const { requireDevUserSwitchPassword } = await import("@/lib/dev-user-switcher");
    expect(requireDevUserSwitchPassword()).toBe("coverdec123");
  });
});

describe("resolveDevPasswordCandidates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("prefers seed admin password before default", async () => {
    vi.stubEnv("DEV_USER_SWITCH_PASSWORD", "coverdec123");
    const { resolveDevPasswordCandidates } = await import("@/lib/dev-user-switcher");
    expect(resolveDevPasswordCandidates("admin@coverdec.local")).toEqual([
      "admin12345",
      "coverdec123",
    ]);
  });

  it("uses default password for other seed users", async () => {
    vi.stubEnv("DEV_USER_SWITCH_PASSWORD", "coverdec123");
    const { resolveDevPasswordCandidates } = await import("@/lib/dev-user-switcher");
    expect(resolveDevPasswordCandidates("claudio@coverdec.local")).toEqual([
      "coverdec123",
    ]);
  });
});

describe("switchDevUser guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects when switcher is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { switchDevUser } = await import("@/features/dev/user-switcher-actions");
    await expect(switchDevUser({ userId: "user-1" })).rejects.toThrow(
      "El conmutador de usuario no está disponible.",
    );
  });
});

describe("listDevSwitcherUsers guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects when switcher is disabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { listDevSwitcherUsers } = await import("@/features/dev/user-switcher-actions");
    await expect(listDevSwitcherUsers()).rejects.toThrow(
      "El conmutador de usuario no está disponible.",
    );
  });
});

describe("groupDevSwitcherUsersByRole", () => {
  it("groups users by role in display order", async () => {
    const { Role } = await import("@/generated/prisma");
    const { groupDevSwitcherUsersByRole } = await import(
      "@/features/dev/dev-switcher-labels"
    );
    const groups = groupDevSwitcherUsersByRole([
      { id: "1", role: Role.OPERARIO, name: "Op" },
      { id: "2", role: Role.ADMIN, name: "Admin" },
      { id: "3", role: Role.JEFE_PRODUCCION, name: "Jefe" },
    ]);
    expect(groups.map((g) => g.role)).toEqual([
      Role.ADMIN,
      Role.JEFE_PRODUCCION,
      Role.OPERARIO,
    ]);
    expect(groups[0]?.users).toHaveLength(1);
    expect(groups[0]?.users[0]?.name).toBe("Admin");
  });
});
