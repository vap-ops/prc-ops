// Spec 65 §A — canonical UUID validator. The regex previously lived as a
// private const in 11 modules; this pins the single shared home plus the
// compat re-export from photos/path so no existing importer breaks.
import { describe, expect, it } from "vitest";

import { UUID_REGEX, isValidUuid } from "@/lib/validate/uuid";
import { isValidUuid as fromPhotosPath } from "@/lib/photos/path";

describe("isValidUuid", () => {
  it("accepts a canonical lowercase v4 UUID", () => {
    expect(isValidUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
  });

  it("accepts uppercase hex (case-insensitive flag)", () => {
    expect(isValidUuid("123E4567-E89B-12D3-A456-426614174000")).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(42)).toBe(false);
    expect(isValidUuid(["123e4567-e89b-12d3-a456-426614174000"])).toBe(false);
  });

  it("rejects malformed strings", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("123e4567e89b12d3a456426614174000")).toBe(false);
    expect(isValidUuid("123e4567-e89b-12d3-a456-42661417400")).toBe(false);
    expect(isValidUuid("123e4567-e89b-12d3-a456-4266141740000")).toBe(false);
    expect(isValidUuid("g23e4567-e89b-12d3-a456-426614174000")).toBe(false);
  });

  it("regex source is the historic shape (drift pin)", () => {
    expect(UUID_REGEX.source).toBe(
      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    );
    expect(UUID_REGEX.flags).toBe("i");
  });

  it("photos/path re-export is the same function (compat)", () => {
    expect(fromPhotosPath).toBe(isValidUuid);
  });
});
