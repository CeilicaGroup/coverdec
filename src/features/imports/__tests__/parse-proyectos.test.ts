import { describe, expect, it } from "vitest";
import { parseProyectoRows } from "../parse-proyectos";
import type { RawMappedRow } from "../excel-workbook";
import { deriveTaskCompleted, isTerminatedStatus } from "../types";

describe("parseProyectoRows", () => {
  it("marks terminated tasks as completed", () => {
    const rows = parseProyectoRows([
      {
        rowIndex: 2,
        values: {
          projectName: "Proyecto A",
          lampName: "Lamp 1",
          frameTypeName: "BASTIDOR NORMAL 150",
          surfaceM2: 10,
          deliveryDate: new Date(Date.UTC(2026, 1, 27)),
          areaName: "CNC",
          processName: "CNC",
          hrPlan: 5,
          hrTotal: 5,
          taskStatus: "Terminado",
          projectStatus: "Terminado",
        },
      },
    ]);
    expect(rows[0]!.isCompleted).toBe(true);
    expect(rows[0]!.archiveProject).toBe(true);
    expect(rows[0]!.status).toBe("ok");
  });

  it("marks in-progress excel rows as completed on import", () => {
    const rows = parseProyectoRows([
      {
        rowIndex: 4,
        values: {
          projectName: "Proyecto B",
          lampName: "Lamp 2",
          frameTypeName: "BASTIDOR NORMAL 150",
          surfaceM2: 10,
          processName: "Ensamblaje",
          hrPlan: 5,
          hrTotal: 2,
          taskStatus: "En proceso",
          projectStatus: "En proceso",
        },
      },
    ]);
    expect(rows[0]!.isCompleted).toBe(true);
    expect(rows[0]!.archiveProject).toBe(false);
  });

  it("errors on missing hr plan", () => {
    const rows = parseProyectoRows([
      {
        rowIndex: 3,
        values: {
          projectName: "P",
          lampName: "L",
          frameTypeName: "B",
          processName: "CNC",
        },
      } as RawMappedRow,
    ]);
    expect(rows[0]!.status).toBe("error");
  });
});

describe("deriveTaskCompleted", () => {
  it("detects terminado status", () => {
    expect(isTerminatedStatus("Terminado")).toBe(true);
    expect(
      deriveTaskCompleted({
        taskStatus: "Terminado",
        hrPlan: 10,
        hrTotal: 2,
        hrPending: 8,
      }),
    ).toBe(true);
  });
});
