"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteElementTypeImage,
  upsertElementTypeImage,
} from "@/features/catalog/actions";
import {
  elementTypeImageAvailable,
  elementTypeImageUrl,
  type ElementTypeImageAvailability,
} from "@/lib/element-type-image";
import { handleActionResult } from "@/lib/mutation-error";
import { cn } from "@/lib/utils";

export function ElementTypeImageUpload({
  elementTypeId,
  elementName,
  imageUpdatedAt,
  availability,
  canManage,
  className,
}: {
  elementTypeId: string;
  elementName: string;
  imageUpdatedAt?: Date | string | number | null;
  availability?: ElementTypeImageAvailability;
  canManage: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const version =
    imageUpdatedAt != null
      ? imageUpdatedAt instanceof Date
        ? imageUpdatedAt.getTime()
        : typeof imageUpdatedAt === "number"
          ? imageUpdatedAt
          : new Date(imageUpdatedAt).getTime()
      : availability?.[elementTypeId];
  const hasImage =
    elementTypeImageAvailable(availability ?? {}, elementTypeId) &&
    version != null &&
    !failed;

  if (!canManage) {
    if (!hasImage) return <span className="text-xs text-muted-foreground">—</span>;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={elementTypeImageUrl(elementTypeId, version)}
        alt={elementName}
        className={cn("size-10 rounded border object-cover", className)}
      />
    );
  }

  function onFileSelected(file: File) {
    startTransition(async () => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const result = await upsertElementTypeImage({
        elementTypeId,
        imageBase64: btoa(binary),
        mimeType: file.type,
      });
      const outcome = handleActionResult("catalog.elementType.image", result);
      if (outcome.success) {
        setFailed(false);
        router.refresh();
      }
    });
  }

  function onDelete() {
    if (!globalThis.confirm(`¿Eliminar la imagen de "${elementName}"?`)) return;
    startTransition(async () => {
      const result = await deleteElementTypeImage({ elementTypeId });
      handleActionResult("catalog.elementType.image.delete", result);
      router.refresh();
    });
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {hasImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={elementTypeImageUrl(elementTypeId, version)}
          alt={elementName}
          onError={() => setFailed(true)}
          className="size-10 rounded border object-cover shrink-0"
        />
      ) : (
        <span className="size-10 rounded border border-dashed bg-muted/40 inline-block shrink-0" />
      )}
      <label className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted shrink-0">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={pending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelected(file);
            e.target.value = "";
          }}
        />
        <Upload className="size-3.5" />
      </label>
      {hasImage ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive shrink-0"
          disabled={pending}
          onClick={onDelete}
          aria-label="Eliminar imagen"
        >
          <Trash2 className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
