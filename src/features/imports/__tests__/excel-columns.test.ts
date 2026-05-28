import { describe, expect, it } from "vitest";
import {
  columnIndexToLetter,
  labelForColumnIndex,
} from "../excel-columns";

describe("columnIndexToLetter", () => {
  it("converts column numbers", () => {
    expect(columnIndexToLetter(1)).toBe("A");
    expect(columnIndexToLetter(7)).toBe("G");
    expect(columnIndexToLetter(26)).toBe("Z");
    expect(columnIndexToLetter(27)).toBe("AA");
  });
});

describe("labelForColumnIndex", () => {
  it("returns descriptive label for mapped column", () => {
    const label = labelForColumnIndex(
      [
        { index: 7, letter: "G", label: "G — Tipo bastidor" },
        { index: 9, letter: "I", label: "I — Proceso" },
      ],
      9,
    );
    expect(label).toBe("I — Proceso");
  });
});
