// Spec 252 — accounting gains READ of the cost surfaces; write sets unchanged.
// Writing failing test first.

import { describe, expect, it } from "vitest";
import {
  PAYROLL_ROLES,
  PAYROLL_VIEW_ROLES,
  SITE_STAFF_ROLES,
  DASHBOARD_VIEW_ROLES,
  MONEY_VIEW_ROLES,
  PM_ROLES,
  roleHome,
} from "@/lib/auth/role-home";

describe("spec 252 read-scoped role sets", () => {
  it("PAYROLL_VIEW_ROLES = payroll writers + accounting", () => {
    expect(PAYROLL_VIEW_ROLES).toEqual([...PAYROLL_ROLES, "accounting"]);
  });

  it("PAYROLL_ROLES (the write set) does NOT gain accounting", () => {
    expect(PAYROLL_ROLES).not.toContain("accounting");
  });

  it("DASHBOARD_VIEW_ROLES = site staff + accounting", () => {
    expect(DASHBOARD_VIEW_ROLES).toEqual([...SITE_STAFF_ROLES, "accounting"]);
  });

  it("MONEY_VIEW_ROLES = PM set + accounting; PM_ROLES itself unchanged", () => {
    expect(MONEY_VIEW_ROLES).toEqual([...PM_ROLES, "accounting"]);
    expect(PM_ROLES).not.toContain("accounting");
  });

  // Spec 349 U2: accounting goes work-queue-first — its home flips to the
  // /accounting/review money-event queue (the GL dashboard /accounting stays a
  // sibling tab). The spec-252 READ widenings above are unaffected by the flip.
  it("accounting lands on the /accounting/review queue (spec 349 U2)", () => {
    expect(roleHome("accounting")).toBe("/accounting/review");
  });
});
