import { LampElementStockStatus } from "@/generated/prisma";

const ASSIGNABLE_STATUSES: LampElementStockStatus[] = [
  LampElementStockStatus.IN_PRODUCTION,
  LampElementStockStatus.AVAILABLE,
];

export function isStockLampAssignable(
  stockStatus: LampElementStockStatus | null | undefined,
): boolean {
  if (!stockStatus) return false;
  return ASSIGNABLE_STATUSES.includes(stockStatus);
}
