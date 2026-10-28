import { describe, expect, it } from "vitest";
import { parseDecimalText, readNumber } from "../cell";

describe("parseDecimalText: números escritos como texto en Excel", () => {
  it.each([
    ["1,5", 1.5],
    ["0.5", 0.5],
    ["0,25", 0.25],
    ["1.234,5", 1234.5],
    ["1,234.5", 1234.5],
    ["1.234.567", 1234567],
    ["1,234,567", 1234567],
    ["1.234.567,89", 1234567.89],
    ["12", 12],
    [" 2,75 ", 2.75],
    ["-0,5", -0.5],
    [",5", 0.5],
    // Un único separador es siempre el decimal (son horas/m²/mediciones, nunca miles).
    ["1.500", 1.5],
    ["1,500", 1.5],
  ])("%s → %s", (text, expected) => {
    expect(parseDecimalText(text)).toBe(expected);
  });

  it.each(["", "  ", "abc", "1h", "1.2.3", "1,2,3", "1.234,5,6", "1,234.5.6", "1..5", "--1"])(
    "%j no es un número",
    (text) => {
      expect(parseDecimalText(text)).toBeNull();
    },
  );
});

describe("readNumber", () => {
  it("lee números, textos y resultados de fórmula con la misma regla", () => {
    expect(readNumber(0.5)).toBe(0.5);
    expect(readNumber("0.5")).toBe(0.5);
    expect(readNumber("1.234,5")).toBe(1234.5);
    expect(readNumber({ formula: "A1/2", result: 0.75 })).toBe(0.75);
    expect(readNumber({ formula: "A1", result: "1,5" })).toBe(1.5);
    expect(readNumber(null)).toBeNull();
    expect(readNumber(undefined)).toBeNull();
    expect(readNumber("n/a")).toBeNull();
  });
});
