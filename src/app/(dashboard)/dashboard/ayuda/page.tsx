import { requireDashboardContext } from "@/lib/context";
import { getHelpForRole } from "@/features/help/content";
import { PageHeader } from "../../_components/page-header";
import { HelpPageClient } from "./help-page-client";

export default async function AyudaPage() {
  const ctx = await requireDashboardContext();
  const help = getHelpForRole(ctx.role);

  return (
    <div className="space-y-6 pl-3 sm:pl-4">
      <PageHeader
        title="Ayuda"
        description={`Guía de uso para ${help.meta.label}. Solo verás lo que aplica a tu rol.`}
      />
      <HelpPageClient help={help} />
    </div>
  );
}
