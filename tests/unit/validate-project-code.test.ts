// Writing failing test first.
//
// Spec 142 U2 — validateProjectCode: the create-project form's fast feedback
// for the project code. The create_project RPC re-checks (22023 empty / >50)
// and the unique constraint is the real guard; this is pure feedback.

import { describe, expect, it } from "vitest";
import { PROJECT_CODE_MAX, validateProjectCode } from "@/lib/projects/validate-settings";

describe("validateProjectCode", () => {
  it("rejects an empty code", () => {
    const r = validateProjectCode("");
    expect(r.ok).toBe(false);
  });

  it("rejects a whitespace-only code", () => {
    const r = validateProjectCode("   ");
    expect(r.ok).toBe(false);
  });

  it("rejects a code longer than the max", () => {
    const r = validateProjectCode("X".repeat(PROJECT_CODE_MAX + 1));
    expect(r.ok).toBe(false);
  });

  it("accepts and trims a valid code", () => {
    const r = validateProjectCode("  PRC-2026-007 ");
    expect(r).toEqual({ ok: true, code: "PRC-2026-007" });
  });

  it("accepts a code at the max length", () => {
    const code = "P".repeat(PROJECT_CODE_MAX);
    const r = validateProjectCode(code);
    expect(r).toEqual({ ok: true, code });
  });
});
