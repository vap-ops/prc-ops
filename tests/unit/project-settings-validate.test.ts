// Unit tests for the project-settings validators (spec 58 / ADR 0042).
// The RPC re-validates server-side; this is the form's fast feedback.

import { describe, it, expect } from "vitest";

import {
  PROJECT_NAME_MAX,
  validateProjectName,
  isValidProjectStatus,
} from "@/lib/projects/validate-settings";

describe("validateProjectName", () => {
  it("trims surrounding whitespace and accepts a normal name", () => {
    const r = validateProjectName("  TFG Lam Sonthi  ");
    expect(r).toEqual({ ok: true, name: "TFG Lam Sonthi" });
  });

  it("rejects blank / whitespace-only with a Thai message", () => {
    for (const raw of ["", "   ", "\n\t"]) {
      const r = validateProjectName(raw);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("accepts exactly PROJECT_NAME_MAX chars, rejects one more (post-trim)", () => {
    expect(validateProjectName("ก".repeat(PROJECT_NAME_MAX)).ok).toBe(true);
    expect(validateProjectName("ก".repeat(PROJECT_NAME_MAX + 1)).ok).toBe(false);
    // Whitespace padding around an at-cap name still passes — cap applies
    // to the trimmed value.
    expect(validateProjectName(`  ${"ก".repeat(PROJECT_NAME_MAX)}  `).ok).toBe(true);
  });
});

describe("isValidProjectStatus", () => {
  it("accepts exactly the four enum values", () => {
    for (const v of ["active", "on_hold", "completed", "archived"]) {
      expect(isValidProjectStatus(v)).toBe(true);
    }
  });

  it("rejects junk and non-strings", () => {
    for (const v of ["deleted", "ACTIVE", "", null, undefined, 7, {}]) {
      expect(isValidProjectStatus(v)).toBe(false);
    }
  });
});
