import { describe, expect, it } from "vitest";
import {
  detectAvailableImportKinds,
  findHorasSheetName,
  findProyectosSheetName,
  findLegacySheetName,
  suggestLegacyMapping,
  suggestMappingForKind,
  isLegacyProduccionWorkbook,
} from "../legacy-produccion-presets";

describe("legacy produccion presets", () => {
  it("detects BBDD sheet for bastidores", () => {
    expect(findLegacySheetName(["Resumen", "BBDD", "Otros"])).toBe("BBDD");
  });

  it("detects proyectos and horas sheets", () => {
    expect(findProyectosSheetName(["🗂️ Proyectos", "BBDD"])).toBe("🗂️ Proyectos");
    expect(findHorasSheetName(["👷horas", "BBDD"])).toBe("👷horas");
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

  it("detects available import kinds", () => {
    const kinds = detectAvailableImportKinds(["BBDD", "🗂️ Proyectos", "👷horas"]);
    expect(kinds).toContain("bastidores");
    expect(kinds).toContain("proyectos");
    expect(kinds).toContain("horas");
    expect(kinds).toContain("produccion_completa");
  });

  it("suggests proyectos mapping", () => {
    const mapping = suggestMappingForKind(["🗂️ Proyectos"], "proyectos");
    expect(mapping.columnMap.projectName).toBe(1);
    expect(mapping.columnMap.hrPlan).toBe(8);
  });
});
