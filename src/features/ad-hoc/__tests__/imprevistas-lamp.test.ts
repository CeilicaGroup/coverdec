import { describe, expect, it, vi } from "vitest";
import { IMPREVISTAS_LAMP_NAME, IMPREVISTAS_LAMP_NAME_KEY } from "@/features/ad-hoc/constants";
import { getOrCreateImprevistasLamp } from "@/features/ad-hoc/imprevistas-lamp";

describe("getOrCreateImprevistasLamp", () => {
  it("uses upsert to avoid duplicate lamp races", async () => {
    const upsert = vi.fn(async () => ({
      id: "lamp-1",
      projectId: "project-pool",
    }));
    const tx = {
      project: {
        findUnique: vi.fn(async () => ({ id: "project-pool", kind: "IMPREVISTAS" })),
      },
      lamp: { upsert },
    };

    const result = await getOrCreateImprevistasLamp(tx as never);

    expect(result).toEqual({ id: "lamp-1", projectId: "project-pool" });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        projectId_nameKey: {
          projectId: "project-pool",
          nameKey: IMPREVISTAS_LAMP_NAME_KEY,
        },
      },
      create: {
        projectId: "project-pool",
        name: IMPREVISTAS_LAMP_NAME,
        nameKey: IMPREVISTAS_LAMP_NAME_KEY,
        units: 1,
      },
      update: {},
      select: { id: true, projectId: true },
    });
  });
});
