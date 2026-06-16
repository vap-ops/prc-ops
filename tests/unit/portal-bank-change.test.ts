// Spec 130 U4 — pure validation for the DC bank-change request form. Thai,
// contractor-facing. The submit RPC re-guards (role/own/dup) + the table CHECKs
// enforce lengths; this is shape/UX validation.

import { describe, it, expect } from "vitest";
import { validateBankChange } from "@/lib/portal/bank-change";

function input(over: Partial<Parameters<typeof validateBankChange>[0]> = {}) {
  return { bankName: "กสิกรไทย", accountNo: "1234567890", accountName: "บริษัท ก", ...over };
}

describe("validateBankChange", () => {
  it("accepts a well-formed bank change", () => {
    expect(validateBankChange(input())).toBeNull();
  });

  it("requires bank name, account no, account name", () => {
    expect(validateBankChange(input({ bankName: "  " }))).not.toBeNull();
    expect(validateBankChange(input({ accountNo: "" }))).not.toBeNull();
    expect(validateBankChange(input({ accountName: " " }))).not.toBeNull();
  });

  it("rejects an account number with no digits", () => {
    expect(validateBankChange(input({ accountNo: "abc-def" }))).not.toBeNull();
  });

  it("rejects over-long fields", () => {
    expect(validateBankChange(input({ bankName: "x".repeat(201) }))).not.toBeNull();
    expect(validateBankChange(input({ accountNo: "1".repeat(51) }))).not.toBeNull();
    expect(validateBankChange(input({ accountName: "x".repeat(201) }))).not.toBeNull();
  });
});
