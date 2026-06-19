// Spec 149 U1 §Tests (TDD, RED first) — pure validation for a gl_accounts row
// (ADR 0057). The UI gate before upsert_gl_account; the RPC + DB CHECKs
// (normal_side domain, code/name length) re-guard. No tree validation here —
// parent existence is a DB concern (the RPC resolves p_parent_code).

import { describe, it, expect } from "vitest";
import { validateGlAccount } from "@/lib/accounting/validate-gl-account";

function input(over: Partial<Parameters<typeof validateGlAccount>[0]> = {}) {
  return {
    code: "1150",
    nameTh: "ลูกหนี้เงินประกันผลงาน",
    normalSide: "debit",
    accountType: "asset",
    ...over,
  };
}

describe("validateGlAccount", () => {
  it("accepts a valid account", () => {
    expect(validateGlAccount(input()).ok).toBe(true);
  });

  it("accepts every one of the five account classes", () => {
    for (const accountType of ["asset", "liability", "equity", "income", "expense"]) {
      expect(validateGlAccount(input({ accountType })).ok).toBe(true);
    }
  });

  it("accepts both debit and credit normal sides", () => {
    expect(validateGlAccount(input({ normalSide: "debit" })).ok).toBe(true);
    expect(validateGlAccount(input({ normalSide: "credit" })).ok).toBe(true);
  });

  it("rejects a missing code", () => {
    const r = validateGlAccount(input({ code: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("รหัสบัญชี");
  });

  it("rejects a whitespace-only code", () => {
    expect(validateGlAccount(input({ code: "   " })).ok).toBe(false);
  });

  it("rejects a code longer than 20 characters", () => {
    expect(validateGlAccount(input({ code: "1".repeat(21) })).ok).toBe(false);
  });

  it("rejects a missing name", () => {
    const r = validateGlAccount(input({ nameTh: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ชื่อบัญชี");
  });

  it("rejects a name longer than 120 characters", () => {
    expect(validateGlAccount(input({ nameTh: "ก".repeat(121) })).ok).toBe(false);
  });

  it("rejects an unknown normal side", () => {
    const r = validateGlAccount(input({ normalSide: "both" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ด้านปกติ");
  });

  it("rejects an unknown account type", () => {
    const r = validateGlAccount(input({ accountType: "contra" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ประเภทบัญชี");
  });
});
