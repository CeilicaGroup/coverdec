"use client";

import { useState } from "react";
import type { ElementTypology } from "@/generated/prisma";
import { ELEMENT_TYPOLOGY_LABELS } from "@/lib/element-typology";
import {
  typologyImageAlt,
  typologyImageAvailable,
  typologyImageUrl,
  typologyImageVersion,
  type TypologyImageAvailability,
} from "@/lib/typology-image";
import { LampElementVisual } from "@/components/lamp-element-visual";
import type { ElementTypeImageAvailability } from "@/lib/element-type-image";
import { cn } from "@/lib/utils";

const SIZE_CLASSES = {
  xs: "size-6",
  sm: "size-8",
  md: "size-12",
  lg: "size-16",
} as const;

type TypologySymbolSize = keyof typeof SIZE_CLASSES;

function typologyAbbreviation(typology: ElementTypology): string {
  return ELEMENT_TYPOLOGY_LABELS[typology].slice(0, 2).toUpperCase();
}

export function TypologySymbol({
  typology,
  availability,
  size = "sm",
  fallback = "abbreviation",
  className,
}: {
  typology: ElementTypology;
  availability?: TypologyImageAvailability;
  size?: TypologySymbolSize;
  fallback?: "abbreviation" | "none";
  className?: string;
}) {
  const available = typologyImageAvailable(availability, typology);
  const version = typologyImageVersion(availability, typology);
  const [failed, setFailed] = useState(false);
  const showImage = available !== false && !failed;

  if (!showImage) {
    if (fallback === "none") return null;
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded border bg-muted text-[9px] font-semibold uppercase text-muted-foreground",
          SIZE_CLASSES[size],
          className,
        )}
        title={ELEMENT_TYPOLOGY_LABELS[typology]}
        aria-hidden
      >
        {typologyAbbreviation(typology)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={version ?? typology}
      src={typologyImageUrl(typology, version)}
      alt={typologyImageAlt(typology)}
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded object-cover border", SIZE_CLASSES[size], className)}
      title={ELEMENT_TYPOLOGY_LABELS[typology]}
    />
  );
}

export function TypologyLabel({
  typology,
  availability,
  size = "sm",
  showText = true,
  showSymbolOnlyWhenImage = false,
  labelClassName,
  className,
}: {
  typology: ElementTypology;
  availability?: TypologyImageAvailability;
  size?: TypologySymbolSize;
  showText?: boolean;
  /** When true, omits the symbol if the typology has no uploaded image. */
  showSymbolOnlyWhenImage?: boolean;
  labelClassName?: string;
  className?: string;
}) {
  const hasImage = typologyImageAvailable(availability, typology) === true;
  const showSymbol = !showSymbolOnlyWhenImage || hasImage;

  return (
    <span className={cn("inline-flex items-center gap-1.5 min-w-0", className)}>
      {showSymbol ? (
        <TypologySymbol
          typology={typology}
          availability={availability}
          size={size}
          fallback={showSymbolOnlyWhenImage ? "none" : "abbreviation"}
        />
      ) : null}
      {showText ? (
        <span className={cn("truncate", labelClassName)}>
          {ELEMENT_TYPOLOGY_LABELS[typology]}
        </span>
      ) : null}
    </span>
  );
}

export function LampElementsSummary({
  elements,
  availability,
  elementTypeImages,
}: {
  elements: Array<{
    elementTypeId: string;
    typology: ElementTypology;
    name: string;
    surfaceM2: number;
    units: number;
  }>;
  availability?: TypologyImageAvailability;
  elementTypeImages?: ElementTypeImageAvailability;
}) {
  if (elements.length === 0) return null;

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
      {elements.map((cfg, index) => {
        const detail = `${cfg.name} · ${cfg.surfaceM2} m²${cfg.units > 1 ? ` · ${cfg.units} uds` : ""}`;
        return (
          <span
            key={`${cfg.elementTypeId}-${cfg.name}-${index}`}
            className="inline-flex items-center gap-1 min-w-0"
          >
            {index > 0 ? (
              <span className="text-muted-foreground" aria-hidden>
                /
              </span>
            ) : null}
            <LampElementVisual
              label={detail}
              typology={cfg.typology}
              typologyImages={availability}
              elementTypeId={cfg.elementTypeId}
              elementTypeImages={elementTypeImages}
              size="md"
              compact
            />
          </span>
        );
      })}
    </span>
  );
}
