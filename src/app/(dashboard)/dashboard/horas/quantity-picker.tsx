"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Hasta aquí se muestra una lista; por encima, un campo numérico (una lista de 260 es inmanejable). */
const MAX_LIST_OPTIONS = 20;

/**
 * Cantidad de tareas de una OT a completar, entre 1 y `max`. `value` es texto porque lo es el
 * estado de los formularios; si no es un número válido se corrige al salir del campo.
 */
export function QuantityPicker({
  id,
  value,
  max,
  onChange,
}: {
  id?: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
}) {
  if (max <= MAX_LIST_OPTIONS) {
    return (
      <Select value={value} onValueChange={(v) => onChange(v ?? "1")}>
        <SelectTrigger id={id} className="h-10">
          <SelectValue placeholder="Selecciona cantidad" />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: Math.max(1, max) }, (_, idx) => idx + 1).map((amount) => (
            <SelectItem key={amount} value={String(amount)}>
              {amount}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        className="h-10"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onChange(String(clampQuantity(value, max)))}
      />
      <span className="text-sm text-muted-foreground whitespace-nowrap">de {max}</span>
      <Button type="button" variant="outline" onClick={() => onChange(String(max))}>
        Todas
      </Button>
    </div>
  );
}

export function clampQuantity(value: string, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, max));
}
