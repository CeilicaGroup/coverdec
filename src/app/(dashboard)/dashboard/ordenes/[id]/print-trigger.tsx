"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintTrigger() {
  return (
    <Button className="gap-2" onClick={() => window.print()}>
      <Printer className="size-4" /> Imprimir
    </Button>
  );
}
