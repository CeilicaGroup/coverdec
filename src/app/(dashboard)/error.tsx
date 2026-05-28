"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error.digest ?? "no-digest", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg space-y-4 p-8">
      <h2 className="text-lg font-semibold">No se pudo cargar el panel</h2>
      <p className="text-sm text-muted-foreground">
        Suele deberse a migraciones de base de datos pendientes tras un despliegue.
        Comprueba que el contenedor ejecutó{" "}
        <code className="rounded bg-muted px-1 font-mono text-xs">
          prisma migrate deploy
        </code>{" "}
        y revisa los logs del servidor.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Referencia para logs:{" "}
          <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <Button type="button" onClick={() => reset()}>
        Reintentar
      </Button>
    </div>
  );
}
