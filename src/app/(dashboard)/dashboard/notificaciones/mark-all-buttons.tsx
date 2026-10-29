"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  markAllNotificationsReadFiltered,
  markAllNotificationsUnread,
} from "@/features/notifications/actions";

type FilterMode = "all" | "read" | "unread";

export function MarkAllButtons({
  filter,
  unread,
  read,
}: {
  filter: FilterMode;
  unread: number;
  read: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const run = (action: typeof markAllNotificationsUnread) =>
    startTransition(async () => {
      const result = await action({ filter });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || unread === 0}
        onClick={() => run(markAllNotificationsReadFiltered)}
      >
        Marcar visibles como leídas
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pending || read === 0}
        onClick={() => run(markAllNotificationsUnread)}
      >
        Marcar visibles como no leídas
      </Button>
    </>
  );
}
