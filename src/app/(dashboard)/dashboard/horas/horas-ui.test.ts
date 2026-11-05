import { describe, expect, it } from "vitest";
import { groupContiguousEntries } from "./entries-list";
import { clampQuantity } from "./quantity-picker";
import { formatEntryDuration } from "@/lib/format";

type Row = Parameters<typeof groupContiguousEntries>[0][number];

function row(id: string, startMin: number, endMin: number, over: Partial<Row> = {}): Row {
  const base = Date.UTC(2026, 10, 5, 7, 0, 0);
  return {
    id,
    userId: "u1",
    projectId: "p1",
    lampId: "l1",
    taskId: id,
    project: "P",
    lamp: "L",
    process: "CNC",
    startedAt: new Date(base + startMin * 60000).toISOString(),
    endedAt: new Date(base + endMin * 60000).toISOString(),
    hours: (endMin - startMin) / 60,
    notes: null,
    source: "MANUAL",
    ...over,
  } as Row;
}

describe("groupContiguousEntries", () => {
  it("agrupa los registros contiguos de un reparto (llegan del más reciente al más antiguo)", () => {
    const groups = groupContiguousEntries([row("c", 20, 30), row("b", 10, 20), row("a", 0, 10)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("no agrupa si hay hueco, otro proyecto/proceso/origen o están activos", () => {
    expect(groupContiguousEntries([row("b", 15, 20), row("a", 0, 10)])).toHaveLength(2);
    expect(groupContiguousEntries([row("b", 10, 20, { projectId: "p2" }), row("a", 0, 10)])).toHaveLength(2);
    expect(groupContiguousEntries([row("b", 10, 20, { process: "PINTURA" as never }), row("a", 0, 10)])).toHaveLength(2);
    expect(groupContiguousEntries([row("b", 10, 20, { source: "TIMER" }), row("a", 0, 10)])).toHaveLength(2);
    expect(groupContiguousEntries([row("b", 10, 20, { endedAt: null }), row("a", 0, 10)])).toHaveLength(2);
  });
});

describe("clampQuantity", () => {
  it("deja el valor entre 1 y el máximo", () => {
    expect(clampQuantity("260", 260)).toBe(260);
    expect(clampQuantity("999", 260)).toBe(260);
    expect(clampQuantity("0", 260)).toBe(1);
    expect(clampQuantity("", 260)).toBe(1);
    expect(clampQuantity("12.7", 260)).toBe(12);
  });
});

describe("formatEntryDuration", () => {
  it("un timer corto no se ve como 0h", () => {
    expect(formatEntryDuration(8 / 3600)).toBe("8 s");
    expect(formatEntryDuration(0)).toBe("0 s");
    expect(formatEntryDuration(20 / 60)).toBe("20 min");
    expect(formatEntryDuration(1.5)).toBe("1.5h");
    expect(formatEntryDuration(1)).toBe("1h");
    expect(formatEntryDuration(null)).toBe("—");
  });
});
