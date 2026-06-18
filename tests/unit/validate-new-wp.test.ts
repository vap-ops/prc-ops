// Writing failing test first.
//
// Spec 142 U4 — validators for the in-app "add work package" form. The
// create_work_package RPC re-checks (22023) and the composite unique constraint
// is the real guard; these are the form's fast feedback.

import { describe, expect, it } from "vitest";
import {
  WP_CODE_MAX,
  WP_NAME_MAX,
  validateWorkPackageCode,
  validateWorkPackageName,
} from "@/lib/work-packages/validate-new-wp";

describe("validateWorkPackageCode", () => {
  it("rejects empty / whitespace", () => {
    expect(validateWorkPackageCode("").ok).toBe(false);
    expect(validateWorkPackageCode("   ").ok).toBe(false);
  });
  it("rejects over-long", () => {
    expect(validateWorkPackageCode("X".repeat(WP_CODE_MAX + 1)).ok).toBe(false);
  });
  it("accepts and trims", () => {
    expect(validateWorkPackageCode("  WP-001 ")).toEqual({ ok: true, code: "WP-001" });
  });
});

describe("validateWorkPackageName", () => {
  it("rejects empty / whitespace", () => {
    expect(validateWorkPackageName("").ok).toBe(false);
    expect(validateWorkPackageName("   ").ok).toBe(false);
  });
  it("rejects over-long", () => {
    expect(validateWorkPackageName("ก".repeat(WP_NAME_MAX + 1)).ok).toBe(false);
  });
  it("accepts and trims", () => {
    expect(validateWorkPackageName("  งานวางท่อ ")).toEqual({ ok: true, name: "งานวางท่อ" });
  });
});
