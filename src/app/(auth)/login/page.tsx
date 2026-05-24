import { Suspense } from "react";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { LoginForm } from "./login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function LoginPage() {
  await redirectIfAuthenticated();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="text-sm text-muted-foreground">Cargando…</div>}>
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
