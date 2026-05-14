import { Suspense } from "react";
import { LoginForm } from "./login-form";
import { RedirectIfAuthed } from "./redirect-if-authed";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
      </CardHeader>
      <CardContent>
        <Suspense fallback={<div className="text-sm text-muted-foreground">Cargando…</div>}>
          <RedirectIfAuthed />
          <LoginForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
