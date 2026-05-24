"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { renameLamp } from "@/features/projects/actions";
import { toast } from "sonner";

export function RenameLampButton({
  lampId,
  initialName,
  canManage,
}: {
  lampId: string;
  initialName: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);

  if (!editing) {
    return (
      <div className="flex items-center gap-1.5 min-w-[120px]">
        <span className="font-semibold text-sm">{initialName}</span>
        {canManage && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => { setName(initialName); setEditing(true); }}
            aria-label="Renombrar lámpara"
          >
            <Pencil className="size-3" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 min-w-[160px]">
      <Input
        className="h-7 text-sm font-semibold w-40"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-emerald-600"
        disabled={pending || !name.trim()}
        onClick={() => {
          if (!name.trim()) return;
          startTransition(async () => {
            try {
              await renameLamp({ lampId, name: name.trim() });
              setEditing(false);
              router.refresh();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Error");
            }
          });
        }}
        aria-label="Guardar nombre"
      >
        <Check className="size-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6 text-destructive"
        onClick={() => setEditing(false)}
        aria-label="Cancelar"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
