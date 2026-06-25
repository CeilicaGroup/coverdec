"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatHours } from "@/lib/format";
import type { OrderDeviationRow } from "@/features/costes/plan-vs-real";

export function OrdersDeviationPanel({ rows }: { rows: OrderDeviationRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mayor desviación esta semana</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>OP</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Real</TableHead>
              <TableHead>Desvío</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={`/dashboard/ordenes/${row.id}`}
                    className="font-mono text-xs font-bold hover:underline"
                  >
                    {row.number}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs">{formatHours(row.plannedHours)}</TableCell>
                <TableCell className="font-mono text-xs">{formatHours(row.actualHours)}</TableCell>
                <TableCell
                  className={`font-mono text-xs font-bold ${
                    row.deviationPct > 0 ? "text-red-600" : "text-emerald-600"
                  }`}
                >
                  {row.deviationPct > 0 ? "+" : ""}
                  {row.deviationPct}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
