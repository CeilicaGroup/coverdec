"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { setLampApprovedForPlanning } from "@/features/projects/actions";
import { toast } from "sonner";

export function LampApprovalToggle({
  lampId,
  isApproved,
  canManage,
}: {
  lampId: string;
  isApproved: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Checkbox
        checked={isApproved}
        disabled={pending}
        onCheckedChange={(checked) => {
          startTransition(async () => {
            const r = await setLampApprovedForPlanning({
              lampId,
              isApprovedForPlanning: checked === true,
            });
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            toast.success(checked ? "Lámpara aprobada para planning" : "Lámpara excluida del planning");
            router.refresh();
          });
        }}
      />
      Aprobada
    </label>
  );
}
