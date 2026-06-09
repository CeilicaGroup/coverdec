import { describe, expect, it } from "vitest";
import {
  GENERIC_RSC_REFRESH_MESSAGE,
  getErrorMessage,
} from "@/lib/error-message";

describe("getErrorMessage", () => {
  it("maps generic Next.js RSC errors to a friendly message", () => {
    const error = new Error(
      "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.",
    );

    expect(getErrorMessage(error)).toBe(GENERIC_RSC_REFRESH_MESSAGE);
  });

  it("keeps actionable business errors", () => {
    expect(getErrorMessage(new Error("Las iniciales ya están en uso"))).toBe(
      "Las iniciales ya están en uso",
    );
  });
});
