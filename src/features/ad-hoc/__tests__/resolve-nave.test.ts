import { describe, expect, it } from "vitest";
import {
  AD_HOC_OPERATORS_DIFFERENT_NAVES_ERROR,
  AD_HOC_OPERATOR_NOT_IN_NAVE_ERROR,
  AD_HOC_PERSON_WITHOUT_NAVE_ERROR,
  AD_HOC_SELECT_NAVE_ERROR,
  formatAdHocPersonLabel,
  resolveAdHocNaveId,
} from "@/features/ad-hoc/resolve-ad-hoc-nave";

describe("resolveAdHocNaveId", () => {
  it("derives nave from a single operator with one nave", () => {
    expect(
      resolveAdHocNaveId([
        { personId: "p1", naveIds: ["nave-cnc"] },
      ]),
    ).toBe("nave-cnc");
  });

  it("uses explicit nave when all operators belong to it", () => {
    expect(
      resolveAdHocNaveId(
        [
          { personId: "p1", naveIds: ["nave-cnc", "nave-pintura"] },
          { personId: "p2", naveIds: ["nave-cnc"] },
        ],
        "nave-cnc",
      ),
    ).toBe("nave-cnc");
  });

  it("rejects operators without a nave", () => {
    expect(() =>
      resolveAdHocNaveId([{ personId: "p1", naveIds: [] }]),
    ).toThrow(AD_HOC_PERSON_WITHOUT_NAVE_ERROR);
  });

  it("rejects operators from different naves without explicit nave", () => {
    expect(() =>
      resolveAdHocNaveId([
        { personId: "p1", naveIds: ["nave-cnc"] },
        { personId: "p2", naveIds: ["nave-pintura"] },
      ]),
    ).toThrow(AD_HOC_OPERATORS_DIFFERENT_NAVES_ERROR);
  });

  it("requires explicit nave when an operator has multiple naves", () => {
    expect(() =>
      resolveAdHocNaveId([
        { personId: "p1", naveIds: ["nave-cnc", "nave-pintura"] },
      ]),
    ).toThrow(AD_HOC_SELECT_NAVE_ERROR);
  });

  it("rejects explicit nave when an operator does not belong to it", () => {
    expect(() =>
      resolveAdHocNaveId(
        [{ personId: "p1", naveIds: ["nave-cnc"] }],
        "nave-pintura",
      ),
    ).toThrow(AD_HOC_OPERATOR_NOT_IN_NAVE_ERROR);
  });
});

describe("formatAdHocPersonLabel", () => {
  it("shows full name with initials when available", () => {
    expect(
      formatAdHocPersonLabel({
        name: "Juan García",
        iniciales: "JG",
        naveCodigo: "CNC",
      }),
    ).toBe("Juan García (JG) · CNC");
  });

  it("falls back to initials when name matches initials", () => {
    expect(
      formatAdHocPersonLabel({
        name: "JG",
        iniciales: "JG",
      }),
    ).toBe("JG");
  });
});
