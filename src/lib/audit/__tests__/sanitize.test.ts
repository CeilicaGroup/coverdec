import { describe, expect, it } from "vitest";
import { sanitizeAuditPayload } from "@/lib/audit/sanitize";

describe("sanitizeAuditPayload", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      email: "user@example.com",
      password: "secret123",
      nested: {
        accessToken: "abc",
        notes: "ok",
      },
      items: [{ refreshToken: "xyz", value: 1 }],
    };

    expect(sanitizeAuditPayload(input)).toEqual({
      email: "user@example.com",
      password: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        notes: "ok",
      },
      items: [{ refreshToken: "[REDACTED]", value: 1 }],
    });
  });

  it("returns primitives unchanged", () => {
    expect(sanitizeAuditPayload("hello")).toBe("hello");
    expect(sanitizeAuditPayload(null)).toBeNull();
  });
});
