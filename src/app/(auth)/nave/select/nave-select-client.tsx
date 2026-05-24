"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface NaveSummary {
  id: string;
  codigo: string;
  nombre: string;
}

export function NaveSelectClient({ naves }: { naves: NaveSummary[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onSelect = (id: string) => setSelected(id);

  const onConfirm = () => {
    if (!selected) return;
    startTransition(async () => {
      await fetch("/api/nave/switch", {
        method: "POST",
        body: JSON.stringify({ naveId: selected }),
        headers: { "Content-Type": "application/json" },
      });
      router.push("/dashboard");
      router.refresh();
    });
  };

  if (naves.length === 0) {
    return (
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          No hay naves configuradas. Contacta con soporte técnico.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">Selecciona tu nave</h1>
        <p className="text-sm text-muted-foreground">
          Elige desde qué nave vas a trabajar hoy
        </p>
      </div>
      <div className="grid gap-3">
        {naves.map((nave) => (
          <Card
            key={nave.id}
            className={cn(
              "cursor-pointer border-2 transition-colors",
              selected === nave.id
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50",
            )}
            onClick={() => onSelect(nave.id)}
          >
            <CardContent className="flex items-center gap-3 py-4">
              <Warehouse className="size-5 shrink-0 text-muted-foreground" />
              <div>
                <div className="font-semibold">{nave.nombre}</div>
                <div className="text-xs text-muted-foreground font-mono">{nave.codigo}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button
        className="w-full"
        disabled={!selected || pending}
        onClick={onConfirm}
      >
        {pending ? "Cargando..." : "Entrar"}
      </Button>
    </div>
  );
}
