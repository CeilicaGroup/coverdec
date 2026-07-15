import { isDevUserSwitcherEnabled } from "@/lib/dev-user-switcher";
import { listDevSwitcherUsers } from "@/features/dev/user-switcher-actions";
import { DevUserSwitcher } from "@/features/dev/dev-user-switcher";

export async function LoginDevSwitcher() {
  if (!isDevUserSwitcherEnabled()) return null;

  const users = await listDevSwitcherUsers();
  if (users.length === 0) return null;

  return (
    <div className="mt-6">
      <DevUserSwitcher users={users} variant="login" />
    </div>
  );
}
