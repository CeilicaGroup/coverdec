import { describe, expect, it } from "vitest";
import {
  isProjectExtrasLamp,
  PROJECT_EXTRAS_LAMP_NAME_KEY,
} from "@/features/projects/project-extras-lamp";

describe("isProjectExtrasLamp", () => {
  it("detects the system extras lamp", () => {
    expect(isProjectExtrasLamp({ nameKey: PROJECT_EXTRAS_LAMP_NAME_KEY })).toBe(
      true,
    );
    expect(isProjectExtrasLamp({ nameKey: "lampara-1" })).toBe(false);
  });
});
