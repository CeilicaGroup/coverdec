import { describe, expect, it } from "vitest";
import { assertSingleNaveId } from "@/features/people/person-naves";

function resolveAdHocNaveId(person: {
  personNaves: Array<{ naveId: string }>;
}): string {
  return assertSingleNaveId(person.personNaves.map((row) => row.naveId));
}

describe("resolveAdHocNaveId", () => {
  it("derives nave from the selected operator", () => {
    expect(
      resolveAdHocNaveId({
        personNaves: [{ naveId: "nave-cnc" }],
      }),
    ).toBe("nave-cnc");
  });

  it("rejects operators without a nave", () => {
    expect(() => resolveAdHocNaveId({ personNaves: [] })).toThrow(
      "Cada operario debe tener exactamente una nave asignada.",
    );
  });
});
