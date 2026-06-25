export interface BomLineInput {
  quantity: number;
  unitCost: number;
}

/** Coste material por unidad fabricada según BOM del catálogo. */
export function computeMaterialCostPerUnit(components: BomLineInput[]): number {
  return components.reduce((sum, row) => sum + row.quantity * row.unitCost, 0);
}

export function computeMaterialCostForUnits(
  components: BomLineInput[],
  units: number,
): number {
  if (units <= 0 || components.length === 0) return 0;
  return Math.round(computeMaterialCostPerUnit(components) * units * 100) / 100;
}
