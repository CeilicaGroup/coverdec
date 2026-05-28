import { describe, expect, it } from "vitest";
import { parseBastidorRows } from "../parse-bastidores";

describe("parseBastidorRows", () => {
  it("parses valid row", () => {
    const rows = parseBastidorRows([
      {
        rowIndex: 2,
        values: {
          frameName: "YPLUS",
          processName: "CNC",
          hoursPerUnit: 1.5,
        },
      },
    ]);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].processCode).toBe("CNC");
    expect(rows[0].hoursPerUnit).toBe(1.5);
  });

  it("derives process code from new labels", () => {
    const rows = parseBastidorRows([
      {
        rowIndex: 3,
        values: {
          frameName: "YPLUS",
          processName: "Proceso inventado",
          hoursPerUnit: 2,
        },
      },
    ]);
    expect(rows[0].status).toBe("ok");
    expect(rows[0].processCode).toBe("PROCESO_INVENTADO");
  });

  it("flags process when code cannot be derived", () => {
    const rows = parseBastidorRows([
      {
        rowIndex: 4,
        values: {
          frameName: "YPLUS",
          processName: "123",
          hoursPerUnit: 2,
        },
      },
    ]);
    expect(rows[0].status).toBe("error");
    expect(rows[0].issues.some((i) => i.code === "UNKNOWN_PROCESS")).toBe(true);
  });

  it("skips empty row", () => {
    const rows = parseBastidorRows([
      { rowIndex: 5, values: { frameName: "", processName: "", hoursPerUnit: null } },
    ]);
    expect(rows[0].status).toBe("skipped");
  });
});
