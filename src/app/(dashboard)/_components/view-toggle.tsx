import Link from "next/link";
import { cn } from "@/lib/utils";

export function ViewToggle({
  basePath,
  view = "plan",
  week,
}: {
  basePath: string;
  view?: string;
  week?: string;
}) {
  const href = (v: string) => {
    const p = new URLSearchParams({ view: v });
    if (week) p.set("week", week);
    return `${basePath}?${p}`;
  };

  return (
    <div className="flex rounded-md border overflow-hidden text-xs font-medium shrink-0">
      <Link
        href={href("plan")}
        className={cn(
          "px-3 py-1.5 transition-colors",
          view === "plan"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        Plan
      </Link>
      <Link
        href={href("actual")}
        className={cn(
          "px-3 py-1.5 transition-colors border-l",
          view === "actual"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        Registros
      </Link>
    </div>
  );
}
