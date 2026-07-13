"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { setLampApprovedForPlanning } from "@/features/projects/actions";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/error-message";

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
            try {
              await setLampApprovedForPlanning({
                lampId,
                isApprovedForPlanning: checked === true,
              });
              toast.success(checked ? "Lámpara aprobada para planning" : "Lámpara excluida del planning");
              router.refresh();
            } catch (err) {
              toast.error(getErrorMessage(err));
            }
          });
        }}
      />
      Aprobada
    </label>
  );
}
