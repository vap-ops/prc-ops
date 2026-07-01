import { describe, expect, it } from "vitest";
import { errorMessageForTelemetry } from "@/lib/telemetry/session";

// Spec 244 U2a — a global error handler feeds js_error friction events. The
// message it stores must be a short, safe string: a name + message for real
// Errors, the string for a raw throw, a fallback otherwise — and NEVER a stack
// trace (PDPA-minimized, size-bounded per spec 244 D5).

describe("errorMessageForTelemetry", () => {
  it("formats an Error as 'Name: message'", () => {
    expect(errorMessageForTelemetry(new Error("boom"))).toBe("Error: boom");
    expect(errorMessageForTelemetry(new TypeError("x is not a function"))).toBe(
      "TypeError: x is not a function",
    );
  });

  it("passes a raw string through", () => {
    expect(errorMessageForTelemetry("raw failure")).toBe("raw failure");
  });

  it("reads a .message off a plain object", () => {
    expect(errorMessageForTelemetry({ message: "objmsg" })).toBe("objmsg");
  });

  it("falls back for null/undefined/unusable input", () => {
    expect(errorMessageForTelemetry(null)).toBe("unknown error");
    expect(errorMessageForTelemetry(undefined)).toBe("unknown error");
    expect(errorMessageForTelemetry({})).toBe("unknown error");
    expect(errorMessageForTelemetry(42)).toBe("unknown error");
  });

  it("truncates to a bounded length (no giant messages / stacks)", () => {
    const long = "e".repeat(500);
    const out = errorMessageForTelemetry(new Error(long));
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.startsWith("Error: eee")).toBe(true);
  });

  it("never leaks a stack trace", () => {
    const err = new Error("kaboom");
    err.stack = "Error: kaboom\n    at secret/path/file.ts:42:1";
    expect(errorMessageForTelemetry(err)).toBe("Error: kaboom");
  });
});
