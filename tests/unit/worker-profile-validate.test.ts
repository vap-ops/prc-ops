// Spec 170 U4b — pure validation for a DC worker's self-edited portal profile:
// contact (phone/email) + emergency contact (name/relation/phone) + DOB. All
// optional (a blank clears that field); caps mirror the workers CHECKs. The
// update_own_worker_profile RPC re-scopes to the caller's own worker — this is
// shape/UX validation only.

import { describe, it, expect } from "vitest";
import { validateWorkerProfile } from "@/lib/portal/worker-profile";

describe("validateWorkerProfile", () => {
  it("accepts a well-formed profile", () => {
    expect(
      validateWorkerProfile({
        phone: "0812345678",
        email: "a@b.co",
        emergencyName: "แม่",
        emergencyRelation: "แม่",
        emergencyPhone: "0899999999",
        dob: "1990-05-01",
      }),
    ).toBeNull();
  });

  it("accepts an all-blank profile (every field clearable)", () => {
    expect(validateWorkerProfile({})).toBeNull();
  });

  it("rejects a malformed email", () => {
    expect(validateWorkerProfile({ email: "nope" })).not.toBeNull();
  });

  it("rejects a phone with no digits", () => {
    expect(validateWorkerProfile({ phone: "abc" })).not.toBeNull();
    expect(validateWorkerProfile({ emergencyPhone: "abc" })).not.toBeNull();
  });

  it("rejects over-long fields", () => {
    expect(validateWorkerProfile({ email: "x".repeat(205) + "@b.co" })).not.toBeNull();
    expect(validateWorkerProfile({ emergencyName: "x".repeat(121) })).not.toBeNull();
    expect(validateWorkerProfile({ emergencyRelation: "x".repeat(61) })).not.toBeNull();
  });

  it("rejects an impossible date of birth", () => {
    expect(validateWorkerProfile({ dob: "2026-02-31" })).not.toBeNull();
    expect(validateWorkerProfile({ dob: "nope" })).not.toBeNull();
  });
});
