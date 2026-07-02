import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import {
  injectTransportBlueprints,
  isSystemTransportTask,
  TRANSPORT_PROCESS_CODE,
} from "@/features/projects/transport-tasks";
import type { TaskBlueprint } from "@/features/projects/lamp-tasks";

describe("injectTransportBlueprints", () => {
  const base = (overrides: Partial<TaskBlueprint>): TaskBlueprint => ({
    process: "CNC",
    estimatedHours: 1,
    order: 0,
    naveId: "n1",
    ...overrides,
  });

  it("does not insert transport when all processes share nave", () => {
    const input = [
      base({ process: "CNC", order: 0, naveId: "n1" }),
      base({ process: "PINTURA", order: 1, naveId: "n1" }),
    ];
    expect(injectTransportBlueprints(input, 0.5)).toEqual(input);
  });

  it("inserts transport between consecutive processes in different naves", () => {
    const result = injectTransportBlueprints(
      [
        base({ process: "CNC", order: 0, naveId: "n1" }),
        base({ process: "PINTURA", order: 1, naveId: "n2" }),
      ],
      0.5,
    );

    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({
      process: TRANSPORT_PROCESS_CODE,
      estimatedHours: 0.5,
      naveId: "n1",
      systemKind: TaskSystemKind.TRANSPORT,
      transportFromNaveId: "n1",
      transportToNaveId: "n2",
      order: 1,
    });
    expect(result[2]?.order).toBe(2);
  });

  it("inserts multiple transports for alternating naves", () => {
    const result = injectTransportBlueprints(
      [
        base({ process: "CNC", order: 0, naveId: "n1" }),
        base({ process: "PINTURA", order: 1, naveId: "n2" }),
        base({ process: "EMBALAJE", order: 2, naveId: "n1" }),
      ],
      0.25,
    );

    expect(result.filter((bp) => bp.process === TRANSPORT_PROCESS_CODE)).toHaveLength(2);
  });
});

describe("isSystemTransportTask", () => {
  it("detects transport by systemKind or process", () => {
    expect(isSystemTransportTask({ systemKind: TaskSystemKind.TRANSPORT })).toBe(true);
    expect(isSystemTransportTask({ process: TRANSPORT_PROCESS_CODE })).toBe(true);
    expect(isSystemTransportTask({ process: "CNC" })).toBe(false);
  });
});
