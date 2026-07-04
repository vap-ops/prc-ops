// Spec 263 U2 — pure validation for the applicant's progressive registration
// form (full_name, phone, date_of_birth, emergency contact name/relation/phone).
// Mirrors validateWorkerProfile's shape/UX. update_own_technician_registration
// re-scopes to the caller's own row; this is shape/UX validation only. Length
// caps mirror the workers/portal precedent (name <=120, phone <=50, relation <=60).

import { describe, it, expect } from "vitest";
import { validateRegistrationProfile } from "@/lib/register/registration-profile";

describe("validateRegistrationProfile", () => {
  it("accepts a fully filled valid profile", () => {
    expect(
      validateRegistrationProfile({
        fullName: "สมชาย ใจดี",
        phone: "0812345678",
        dob: "1990-05-01",
        emergencyName: "สมหญิง ใจดี",
        emergencyRelation: "ภรรยา",
        emergencyPhone: "0898765432",
      }),
    ).toBeNull();
  });

  it("accepts an all-blank progressive-fill payload (nothing required yet)", () => {
    expect(
      validateRegistrationProfile({
        fullName: "",
        phone: "",
        dob: "",
        emergencyName: "",
        emergencyRelation: "",
        emergencyPhone: "",
      }),
    ).toBeNull();
  });

  it("rejects an over-long full name", () => {
    const msg = validateRegistrationProfile({
      fullName: "a".repeat(121),
      phone: "",
      dob: "",
      emergencyName: "",
      emergencyRelation: "",
      emergencyPhone: "",
    });
    expect(msg).toMatch(/ยาวเกินไป/);
  });

  it("rejects a phone with no digits", () => {
    const msg = validateRegistrationProfile({
      fullName: "",
      phone: "abc",
      dob: "",
      emergencyName: "",
      emergencyRelation: "",
      emergencyPhone: "",
    });
    expect(msg).toMatch(/ไม่ถูกต้อง/);
  });

  it("rejects an impossible calendar date", () => {
    const msg = validateRegistrationProfile({
      fullName: "",
      phone: "",
      dob: "2026-02-31",
      emergencyName: "",
      emergencyRelation: "",
      emergencyPhone: "",
    });
    expect(msg).toMatch(/วันเกิดไม่ถูกต้อง/);
  });

  it("rejects an over-long emergency contact name", () => {
    const msg = validateRegistrationProfile({
      fullName: "",
      phone: "",
      dob: "",
      emergencyName: "a".repeat(121),
      emergencyRelation: "",
      emergencyPhone: "",
    });
    expect(msg).toMatch(/ยาวเกินไป/);
  });

  it("rejects an emergency phone with no digits", () => {
    const msg = validateRegistrationProfile({
      fullName: "",
      phone: "",
      dob: "",
      emergencyName: "",
      emergencyRelation: "",
      emergencyPhone: "xyz",
    });
    expect(msg).toMatch(/ไม่ถูกต้อง/);
  });
});
