// Spec 296 — client-side UX pre-check for the applicant's declared bank fields.
// This mirrors the authoritative DB gate (record_own_staff_bank): all three
// non-empty; the account number, after stripping spaces/dashes, is 6-20 digits.
// The DB is the source of truth — this only gives immediate feedback + drives the
// approval-floor checklist's `hasBankFields`.

import { describe, it, expect } from "vitest";
import { normalizeAccountNumber, validateRegistrationBank } from "@/lib/register/registration-bank";

describe("normalizeAccountNumber", () => {
  it("strips spaces and dashes only", () => {
    expect(normalizeAccountNumber("123-456 789")).toBe("123456789");
    expect(normalizeAccountNumber("  0011223344  ")).toBe("0011223344");
  });
});

describe("validateRegistrationBank", () => {
  const OK = { bankName: "ธ.กสิกรไทย", accountNumber: "1234567890", accountName: "สมชาย ใจดี" };

  it("accepts a complete, well-formed declaration", () => {
    expect(validateRegistrationBank(OK)).toBeNull();
  });

  it("accepts an account number written with spaces/dashes (normalized)", () => {
    expect(validateRegistrationBank({ ...OK, accountNumber: "123-456 7890" })).toBeNull();
  });

  it("rejects an empty bank name", () => {
    expect(validateRegistrationBank({ ...OK, bankName: "  " })).toBeTruthy();
  });

  it("rejects an empty account holder name", () => {
    expect(validateRegistrationBank({ ...OK, accountName: "" })).toBeTruthy();
  });

  it("rejects a too-short account number (<6 digits)", () => {
    expect(validateRegistrationBank({ ...OK, accountNumber: "12345" })).toBeTruthy();
  });

  it("rejects a too-long account number (>20 digits)", () => {
    expect(
      validateRegistrationBank({ ...OK, accountNumber: "123456789012345678901" }),
    ).toBeTruthy();
  });

  it("rejects a non-digit account number", () => {
    expect(validateRegistrationBank({ ...OK, accountNumber: "12ab34" })).toBeTruthy();
  });
});
