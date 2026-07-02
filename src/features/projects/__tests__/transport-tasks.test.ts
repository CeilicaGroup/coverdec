import { describe, expect, it } from "vitest";
import { TaskSystemKind } from "@/generated/prisma";
import {
  buildInterleavedTaskOrder,
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

describe("buildInterleavedTaskOrder", () => {
  it("places transport immediately after its linked production task", () => {
    const order = buildInterleavedTaskOrder(
      [
        { id: "cnc", order: 0 },
        { id: "ens", order: 1 },
        { id: "lij", order: 2 },
      ],
      [{ id: "t1", transportAfterTaskId: "ens" }],
    );

    expect(order).toEqual(["cnc", "ens", "t1", "lij"]);
  });

  it("places multiple transports after their respective production tasks", () => {
    const order = buildInterleavedTaskOrder(
      [
        { id: "cnc", order: 0 },
        { id: "ens", order: 1 },
        { id: "lij", order: 2 },
      ],
      [
        { id: "t1", transportAfterTaskId: "cnc" },
        { id: "t2", transportAfterTaskId: "ens" },
      ],
    );

    expect(order).toEqual(["cnc", "t1", "ens", "t2", "lij"]);
  });

  it("does not place transports before earlier production tasks in the chain", () => {
    const order = buildInterleavedTaskOrder(
      [
        { id: "cnc", order: 0 },
        { id: "ens", order: 1 },
      ],
      [{ id: "t1", transportAfterTaskId: "ens" }],
    );

    const cncIndex = order.indexOf("cnc");
    const ensIndex = order.indexOf("ens");
    const transportIndex = order.indexOf("t1");

    expect(cncIndex).toBeLessThan(ensIndex);
    expect(transportIndex).toBeGreaterThan(ensIndex);
    expect(transportIndex).not.toBeLessThan(ensIndex);
  });

  it("appends orphan transports at the end", () => {
    const order = buildInterleavedTaskOrder(
      [{ id: "cnc", order: 0 }],
      [{ id: "orphan", transportAfterTaskId: null }],
    );

    expect(order).toEqual(["cnc", "orphan"]);
  });
});
