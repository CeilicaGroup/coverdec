import { describe, expect, it } from "vitest";
import { Role } from "@/generated/prisma";
import {
  actualRecordsUserIdForContext,
  canSeePersonRecords,
  enrichActualSummariesWithTeam,
} from "@/features/planning/record-visibility";

describe("record-visibility", () => {
  it("operario scopea registros a su userId", () => {
    expect(
      actualRecordsUserIdForContext({ role: Role.OPERARIO, userId: "user-1" }),
    ).toBe("user-1");
  });

  it("admin y jefe no scopean registros", () => {
    expect(
      actualRecordsUserIdForContext({ role: Role.ADMIN, userId: "admin-1" }),
    ).toBeUndefined();
    expect(
      actualRecordsUserIdForContext({
        role: Role.JEFE_PRODUCCION,
        userId: "jefe-1",
      }),
    ).toBeUndefined();
  });

  it("operario solo ve registros de su persona", () => {
    expect(
      canSeePersonRecords({ role: Role.OPERARIO, personId: "p1" }, "p1"),
    ).toBe(true);
    expect(
      canSeePersonRecords({ role: Role.OPERARIO, personId: "p1" }, "p2"),
    ).toBe(false);
    expect(
      canSeePersonRecords({ role: Role.OPERARIO, personId: null }, "p1"),
    ).toBe(false);
  });

  it("admin y jefe ven registros de cualquier persona", () => {
    expect(
      canSeePersonRecords({ role: Role.ADMIN, personId: null }, "p2"),
    ).toBe(true);
    expect(
      canSeePersonRecords({ role: Role.JEFE_PRODUCCION, personId: "p1" }, "p2"),
    ).toBe(true);
  });

  it("enriquece peopleHours con todo el equipo y horas ajenas a cero", () => {
    const summaries = enrichActualSummariesWithTeam(
      new Map([
        [
          "2026-06-15",
          {
            totalHours: 4,
            assignmentCount: 1,
            people: [{ id: "p1", iniciales: "IH", color: "#000" }],
            peopleHours: [{ id: "p1", iniciales: "IH", color: "#000", hours: 4 }],
            projectCount: 1,
            topProjects: [],
            projects: [],
            processes: [],
            processHours: [],
          },
        ],
      ]),
      [
        { id: "p1", iniciales: "IH", color: "#000" },
        { id: "p2", iniciales: "CL", color: "#111" },
      ],
    );
    const day = summaries.get("2026-06-15");
    expect(day?.peopleHours).toEqual([
      { id: "p1", iniciales: "IH", color: "#000", hours: 4 },
      { id: "p2", iniciales: "CL", color: "#111", hours: 0 },
    ]);
  });
});
