// Writing failing test first.
//
// Spec 71: work-package notes are a backup-capture field. The pure
// validator is the testable seam the server action relays through —
// trim, empty→null (clearing), and the 1000-char app cap (matches the
// spec-48 requester-notes cap; the DB CHECK at 2000 is the abuse backstop).

import { describe, expect, it } from "vitest";

import { validateWorkPackageNotes } from "@/lib/work-packages/validate-notes";

describe("validateWorkPackageNotes", () => {
  it("accepts a normal note, trimmed", () => {
    expect(validateWorkPackageNotes("  ผนังร้าวฝั่งทิศเหนือ  ")).toEqual({
      ok: true,
      value: "ผนังร้าวฝั่งทิศเหนือ",
    });
  });

  it("treats empty / whitespace / nullish as a cleared note (null)", () => {
    expect(validateWorkPackageNotes("")).toEqual({ ok: true, value: null });
    expect(validateWorkPackageNotes("   ")).toEqual({ ok: true, value: null });
    expect(validateWorkPackageNotes(null)).toEqual({ ok: true, value: null });
    expect(validateWorkPackageNotes(undefined)).toEqual({ ok: true, value: null });
  });

  it("accepts exactly 1000 characters", () => {
    const s = "ก".repeat(1000);
    expect(validateWorkPackageNotes(s)).toEqual({ ok: true, value: s });
  });

  it("rejects more than 1000 characters", () => {
    const result = validateWorkPackageNotes("ก".repeat(1001));
    expect(result.ok).toBe(false);
  });
});
