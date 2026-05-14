"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintToolbar() {
  return (
    <Button
      type="button"
      variant="outline"
      className="no-print gap-2"
      onClick={() => window.print()}
    >
      <Printer className="size-4" />
      Imprimir
    </Button>
  );
}
