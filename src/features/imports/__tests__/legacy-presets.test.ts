import { describe, expect, it } from "vitest";
import {
  findLegacySheetName,
  suggestLegacyMapping,
  isLegacyProduccionWorkbook,
} from "../legacy-produccion-presets";

describe("legacy produccion presets", () => {
  it("detects BBDD sheet for bastidores", () => {
    expect(findLegacySheetName(["Resumen", "BBDD", "Otros"])).toBe("BBDD");
  });

  it("detects legacy workbook", () => {
    expect(isLegacyProduccionWorkbook(["BBDD", "Proyectos"])).toBe(true);
  });

  it("suggests legacy column mapping", () => {
    const mapping = suggestLegacyMapping(["BBDD"]);
    expect(mapping.sheetName).toBe("BBDD");
    expect(mapping.columnMap.frameName).toBe(7);
    expect(mapping.columnMap.processName).toBe(9);
    expect(mapping.columnMap.hoursPerUnit).toBe(10);
  });
});
