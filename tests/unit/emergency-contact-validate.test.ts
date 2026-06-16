// Spec 131 U2b — pure validation for the DC's self-edited emergency contact
// (portal). Thai, contractor-facing. The update_own_emergency_contact RPC
// re-scopes to the caller's own contractor; this is shape/UX validation.

import { describe, it, expect } from "vitest";
import { validateEmergencyContact } from "@/lib/portal/emergency-contact";

function input(over: Partial<Parameters<typeof validateEmergencyContact>[0]> = {}) {
  return { name: "สมชาย ใจดี", relation: "พี่ชาย", phone: "0812345678", ...over };
}

describe("validateEmergencyContact", () => {
  it("accepts a well-formed contact", () => {
    expect(validateEmergencyContact(input())).toBeNull();
  });

  it("requires a name and a phone", () => {
    expect(validateEmergencyContact(input({ name: "  " }))).not.toBeNull();
    expect(validateEmergencyContact(input({ phone: "" }))).not.toBeNull();
  });

  it("rejects a phone with no digits", () => {
    expect(validateEmergencyContact(input({ phone: "no-number" }))).not.toBeNull();
  });

  it("allows an empty relation (optional)", () => {
    expect(validateEmergencyContact(input({ relation: "" }))).toBeNull();
  });

  it("rejects over-long fields", () => {
    expect(validateEmergencyContact(input({ name: "x".repeat(121) }))).not.toBeNull();
    expect(validateEmergencyContact(input({ relation: "x".repeat(61) }))).not.toBeNull();
    expect(validateEmergencyContact(input({ phone: "1".repeat(31) }))).not.toBeNull();
  });
});
