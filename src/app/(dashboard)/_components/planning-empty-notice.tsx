import { AlertCircle } from "lucide-react";

interface PlanningEmptyNoticeProps {
  hiddenDraft?: boolean;
  noPublished?: boolean;
}

export function PlanningEmptyNotice({
  hiddenDraft = false,
  noPublished = false,
}: PlanningEmptyNoticeProps) {
  if (!hiddenDraft && !noPublished) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-100">
      <AlertCircle className="size-4 shrink-0 mt-0.5" />
      <p>
        {hiddenDraft
          ? "Hay un borrador para esta semana. Activa «+ borrador» en el menú lateral para verlo."
          : "No hay planning publicado para esta semana."}
      </p>
    </div>
  );
}
