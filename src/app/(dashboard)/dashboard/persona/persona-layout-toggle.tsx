import Link from "next/link";
import { cn } from "@/lib/utils";

export type PersonaLayout = "calendario" | "lista";

export function parsePersonaLayout(value: string | undefined): PersonaLayout {
  return value === "lista" ? "lista" : "calendario";
}

export function PersonaLayoutToggle({
  basePath,
  layout,
  view,
  week,
}: {
  basePath: string;
  layout: PersonaLayout;
  view: string;
  week?: string;
}) {
  const href = (next: PersonaLayout) => {
    const p = new URLSearchParams({ view, layout: next });
    if (week) p.set("week", week);
    return `${basePath}?${p}`;
  };

  return (
    <div
      className="flex rounded-md border overflow-hidden text-xs font-medium shrink-0"
      role="group"
      aria-label="Formato de vista por persona"
    >
      <Link
        href={href("calendario")}
        className={cn(
          "px-3 py-1.5 transition-colors",
          layout === "calendario"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        Calendario
      </Link>
      <Link
        href={href("lista")}
        className={cn(
          "px-3 py-1.5 transition-colors border-l",
          layout === "lista"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        Lista
      </Link>
    </div>
  );
}
