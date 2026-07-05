// Spec 264 G2 — the one-page self-service form surfaces the approver's approval
// floor (full_name + a live id_card upload + a PDPA consent record — mirrors the
// approve_staff_registration DB floor, spec doc §"Role-parametric approve" step 4)
// as a plain-language checklist so the applicant knows what's still missing before
// an approver can act. Pure view-model — no RPC/DB access.

import { describe, it, expect } from "vitest";
import { registrationApprovalFloor } from "@/lib/register/registration-floor";

describe("registrationApprovalFloor", () => {
  it("reports every requirement missing for a brand-new registration", () => {
    const floor = registrationApprovalFloor({
      fullName: null,
      hasIdCard: false,
      hasConsent: false,
    });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["full_name", "id_card", "consent"]);
  });

  it("reports full_name satisfied once non-blank", () => {
    const floor = registrationApprovalFloor({
      fullName: "สมชาย ใจดี",
      hasIdCard: false,
      hasConsent: false,
    });
    expect(floor.missing).toEqual(["id_card", "consent"]);
  });

  it("treats a blank/whitespace-only name as still missing", () => {
    const floor = registrationApprovalFloor({
      fullName: "   ",
      hasIdCard: true,
      hasConsent: true,
    });
    expect(floor.met).toBe(false);
    expect(floor.missing).toEqual(["full_name"]);
  });

  it("is met once all three are present", () => {
    const floor = registrationApprovalFloor({
      fullName: "สมชาย ใจดี",
      hasIdCard: true,
      hasConsent: true,
    });
    expect(floor.met).toBe(true);
    expect(floor.missing).toEqual([]);
  });

  it("profile_photo is never part of the floor (optional, LINE-avatar fallback)", () => {
    const floor = registrationApprovalFloor({
      fullName: "สมชาย ใจดี",
      hasIdCard: true,
      hasConsent: true,
    });
    expect(floor.missing).not.toContain("profile_photo");
  });
});
