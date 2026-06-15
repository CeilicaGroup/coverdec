import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end justify-between gap-3 pb-4 border-b">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
