// Spec 264 G2 / spec 296 — the one-page self-service form surfaces the approver's
// approval floor (full_name + a live id_card upload + a book_bank passbook photo +
// declared bank fields + a PDPA consent record — mirrors the
// approve_staff_registration DB floor) as a plain-language checklist so the
// applicant knows what's still missing before an approver can act. Pure view-model.

import { describe, it, expect } from "vitest";
import { registrationApprovalFloor } from "@/lib/register/registration-floor";

const FULL = {
  fullName: "สมชาย ใจดี",
  hasIdCard: true,
  hasBookBank: true,
  hasBankFields: true,
  hasConsent: true,
} as const;

describe("registrationApprovalFloor", () => {
  it("reports every requirement missing for a brand-new registration", () => {
    const floor = registrationApprovalFloor({
      fullName: null,
      hasIdCard: false,
      hasBookBank: false,
      hasBankFields: false,
      hasConsent: false,
    });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["full_name", "id_card", "book_bank", "bank_fields", "consent"]);
  });

  it("reports full_name satisfied once non-blank", () => {
    const floor = registrationApprovalFloor({
      ...FULL,
      fullName: "สมชาย ใจดี",
      hasIdCard: false,
      hasBookBank: false,
      hasBankFields: false,
      hasConsent: false,
    });
    expect(floor.missing).toEqual(["id_card", "book_bank", "bank_fields", "consent"]);
  });

  it("treats a blank/whitespace-only name as still missing", () => {
    const floor = registrationApprovalFloor({ ...FULL, fullName: "   " });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["full_name"]);
  });

  it("reports a missing book_bank passbook photo", () => {
    const floor = registrationApprovalFloor({ ...FULL, hasBookBank: false });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["book_bank"]);
  });

  it("reports missing declared bank fields", () => {
    const floor = registrationApprovalFloor({ ...FULL, hasBankFields: false });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["bank_fields"]);
  });

  it("is met once all five are present", () => {
    const floor = registrationApprovalFloor(FULL);
    expect(floor.met).toBe(true);
    expect(floor.missing).toEqual([]);
  });

  it("profile_photo is never part of the floor (optional, LINE-avatar fallback)", () => {
    const floor = registrationApprovalFloor(FULL);
    expect(floor.missing).not.toContain("profile_photo");
  });

  // Spec 328 — subcon members are pay-exempt: the firm is paid per WP, PRC never
  // collects their bank. bankExempt mirrors the approve RPC's contractor arm,
  // which skips the book_bank + bank-fields floors (id_card + PDPA stay).
  it("spec 328: bankExempt drops book_bank + bank_fields from the floor", () => {
    const floor = registrationApprovalFloor({
      ...FULL,
      hasBookBank: false,
      hasBankFields: false,
      bankExempt: true,
    });
    expect(floor.met).toBe(true);
    expect(floor.missing).toEqual([]);
  });

  it("spec 328: bankExempt still requires full_name, id_card and consent", () => {
    const floor = registrationApprovalFloor({
      fullName: null,
      hasIdCard: false,
      hasBookBank: false,
      hasBankFields: false,
      hasConsent: false,
      bankExempt: true,
    });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["full_name", "id_card", "consent"]);
  });
});
