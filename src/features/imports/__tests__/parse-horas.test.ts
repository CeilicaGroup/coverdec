import { describe, expect, it } from "vitest";
import { parseHorasRows } from "../parse-horas";

describe("parseHorasRows", () => {
  it("sums normal and extra hours", () => {
    const rows = parseHorasRows([
      {
        rowIndex: 2,
        values: {
          workDate: new Date(Date.UTC(2025, 11, 18)),
          operatorName: "Ihor Alieksieiev",
          projectName: "Proyecto",
          lampName: "Lamp",
          areaName: "Fabricación",
          processName: "Ensamblaje",
          normalHours: 4,
          extraHours: 1.5,
        },
      },
    ]);
    expect(rows[0]!.totalHours).toBe(5.5);
    expect(rows[0]!.status).toBe("ok");
  });

  it("errors when no hours", () => {
    const rows = parseHorasRows([
      {
        rowIndex: 3,
        values: {
          workDate: new Date(Date.UTC(2025, 11, 18)),
          operatorName: "Op",
          projectName: "P",
          lampName: "L",
          processName: "CNC",
        },
      },
    ]);
    expect(rows[0]!.status).toBe("error");
  });
});
