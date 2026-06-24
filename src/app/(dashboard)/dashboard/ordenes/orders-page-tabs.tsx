"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrdersTable, type OrderRow, type OrdersKpis } from "./orders-table";
import { OrdersCalendar, type CalendarOrderBlock } from "./orders-calendar";
import type { OrderDetailData } from "./order-detail-drawer";
import { OrderDetailDrawer } from "./order-detail-drawer";

export function OrdersPageTabs({
  orders,
  kpis,
  processOptions,
  calendarOrders,
  orderDetailsById,
}: {
  orders: OrderRow[];
  kpis: OrdersKpis;
  processOptions: string[];
  calendarOrders: CalendarOrderBlock[];
  orderDetailsById: Record<string, OrderDetailData>;
}) {
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);

  return (
    <>
      <Tabs defaultValue="listado">
        <TabsList>
          <TabsTrigger value="listado">Listado</TabsTrigger>
          <TabsTrigger value="calendario">Calendario</TabsTrigger>
        </TabsList>
        <TabsContent value="listado" className="mt-4">
          <OrdersTable
            orders={orders}
            kpis={kpis}
            processOptions={processOptions}
            onOpenOrder={(id) => setDrawerOrderId(id)}
          />
        </TabsContent>
        <TabsContent value="calendario" className="mt-4">
          <OrdersCalendar orders={calendarOrders} />
        </TabsContent>
      </Tabs>
      <OrderDetailDrawer
        order={drawerOrderId ? (orderDetailsById[drawerOrderId] ?? null) : null}
        open={drawerOrderId != null}
        onOpenChange={(open) => {
          if (!open) setDrawerOrderId(null);
        }}
      />
    </>
  );
}
