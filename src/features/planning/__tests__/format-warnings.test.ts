import { describe, expect, it } from "vitest";
import {
  formatTaskPlanningLabel,
  replaceProcessCodesInReason,
} from "../format-warnings";

describe("formatTaskPlanningLabel", () => {
  it("joins project, lamp and process", () => {
    expect(
      formatTaskPlanningLabel({
        process: "Ensamblaje",
        project: { name: "DRUNI CC Splau" },
        lamp: { name: "Hair espejo caja" },
      }),
    ).toBe("DRUNI CC Splau · Hair espejo caja · Ensamblaje");
  });

  it("prefers process catalog label over code", () => {
    expect(
      formatTaskPlanningLabel({
        process: "IMPRIMACION",
        processLabel: "Imprimación",
        project: { name: "Proyecto X" },
        lamp: { name: "Cruz" },
      }),
    ).toBe("Proyecto X · Cruz · Imprimación");
  });
});

describe("replaceProcessCodesInReason", () => {
  it("replaces quoted process codes with labels", () => {
    const labels = new Map([
      ["IMPRIMACION", "Imprimación"],
      ["LIJADO_Y_O_MASILLADO_DI", "Lijado y/o masillado"],
    ]);
    expect(
      replaceProcessCodesInReason(
        "No se puede planificar «LIJADO_Y_O_MASILLADO_DI» porque el proceso anterior «IMPRIMACION» no tiene operario.",
        labels,
      ),
    ).toBe(
      "No se puede planificar «Lijado y/o masillado» porque el proceso anterior «Imprimación» no tiene operario.",
    );
  });

  it("leaves unknown codes unchanged", () => {
    expect(
      replaceProcessCodesInReason("Proceso «FOO» desconocido", new Map()),
    ).toBe("Proceso «FOO» desconocido");
  });
});
