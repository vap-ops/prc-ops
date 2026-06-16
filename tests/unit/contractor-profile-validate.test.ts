// Spec 132 U1 — pure validation for the DC's self-edited contactability fields
// (portal). Thai, contractor-facing. Caps mirror the contractors CHECKs
// (contact_person ≤120, email ≤200, mailing_address ≤500, phone ≤30). All fields
// are optional — a blank value clears that field. The RPC re-scopes to own row.

import { describe, it, expect } from "vitest";
import { validateContractorProfile } from "@/lib/portal/contractor-profile";

function input(over: Partial<Parameters<typeof validateContractorProfile>[0]> = {}) {
  return {
    phone: "0812345678",
    email: "dc@example.com",
    contactPerson: "สมชาย ใจดี",
    mailingAddress: "123 ถนนสุขุมวิท กรุงเทพฯ",
    ...over,
  };
}

describe("validateContractorProfile", () => {
  it("accepts a well-formed profile", () => {
    expect(validateContractorProfile(input())).toBeNull();
  });

  it("accepts all-blank (every field clears)", () => {
    expect(
      validateContractorProfile({ phone: "", email: "", contactPerson: "", mailingAddress: "" }),
    ).toBeNull();
  });

  it("accepts an empty object (nothing to change)", () => {
    expect(validateContractorProfile({})).toBeNull();
  });

  it("rejects a phone with no digits", () => {
    expect(validateContractorProfile(input({ phone: "no-number" }))).not.toBeNull();
  });

  it("rejects a malformed email", () => {
    expect(validateContractorProfile(input({ email: "not-an-email" }))).not.toBeNull();
    expect(validateContractorProfile(input({ email: "a@b" }))).not.toBeNull();
    expect(validateContractorProfile(input({ email: "a b@c.com" }))).not.toBeNull();
  });

  it("rejects over-long fields", () => {
    expect(validateContractorProfile(input({ phone: "1".repeat(31) }))).not.toBeNull();
    expect(validateContractorProfile(input({ email: `${"a".repeat(195)}@b.com` }))).not.toBeNull();
    expect(validateContractorProfile(input({ contactPerson: "x".repeat(121) }))).not.toBeNull();
    expect(validateContractorProfile(input({ mailingAddress: "x".repeat(501) }))).not.toBeNull();
  });
});
