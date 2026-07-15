"use client";

import { useState } from "react";
import type { ElementTypology } from "@/generated/prisma";
import { TypologySymbol } from "@/components/typology-symbol";
import {
  elementTypeImageAvailable,
  elementTypeImageUrl,
  elementTypeImageVersion,
  type ElementTypeImageAvailability,
} from "@/lib/element-type-image";
import type { TypologyImageAvailability } from "@/lib/typology-image";
import { cn } from "@/lib/utils";

const MAIN_SIZE = {
  xs: "size-10",
  sm: "size-12",
  md: "size-16",
  lg: "size-20",
} as const;

type LampElementVisualSize = keyof typeof MAIN_SIZE;

export function LampElementVisual({
  label,
  typology,
  typologyImages,
  elementTypeId,
  elementTypeImages,
  size = "sm",
  compact = false,
  className,
}: {
  label: string | null | undefined;
  typology?: ElementTypology;
  typologyImages?: TypologyImageAvailability;
  elementTypeId?: string | null;
  elementTypeImages?: ElementTypeImageAvailability;
  size?: LampElementVisualSize;
  compact?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const imageVersion = elementTypeImageVersion(elementTypeImages, elementTypeId);
  const hasElementTypeImage =
    elementTypeId != null &&
    elementTypeImageAvailable(elementTypeImages, elementTypeId) &&
    !failed;

  if (!label && !typology && !hasElementTypeImage) return null;

  return (
    <div
      className={cn(
        "inline-flex items-center min-w-0",
        compact ? "gap-1" : "gap-1.5",
        className,
      )}
    >
      {hasElementTypeImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={elementTypeImageUrl(elementTypeId!, imageVersion)}
          alt={label ?? "Elemento"}
          onError={() => setFailed(true)}
          className={cn("shrink-0 rounded border object-cover", MAIN_SIZE[size])}
        />
      ) : null}
      {typology ? (
        <TypologySymbol
          typology={typology}
          availability={typologyImages}
          size="xs"
        />
      ) : null}
      {label ? (
        <span
          className={cn(
            "truncate text-muted-foreground",
            compact ? "text-[10px] leading-tight" : "text-xs",
          )}
        >
          {compact ? label : <>Bastidor: <span className="text-foreground/90">{label}</span></>}
        </span>
      ) : null}
    </div>
  );
}
