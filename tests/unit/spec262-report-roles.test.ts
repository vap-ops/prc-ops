// Writing failing test first.
//
// Spec 262 U2 — the procurement report gate. PURCHASE_REPORT_ROLES must
// mirror the purchase_report RPC's inline literal list exactly (spec 262
// U1's migration) — a source-scan pin so a future PM_ROLES/PURCHASING_ROLES
// widen can't silently change who reaches /requests/reports. The
// purchaser-only slice reuses PROCUREMENT_MANAGER_ROLES (spec 261's "manager
// tier ∪ procurement_manager" set) rather than a new constant — the RPC's
// by-purchaser check is exactly that predicate.
import { describe, expect, it } from "vitest";
import {
  PURCHASE_REPORT_ROLES,
  PROCUREMENT_MANAGER_ROLES,
  isProcurementManagerTier,
} from "@/lib/auth/role-home";

describe("PURCHASE_REPORT_ROLES (spec 262 U1 RPC gate)", () => {
  it("matches the RPC's 6-role literal list exactly", () => {
    expect(PURCHASE_REPORT_ROLES).toEqual([
      "procurement",
      "procurement_manager",
      "project_manager",
      "project_director",
      "super_admin",
      "accounting",
    ]);
  });

  it("does NOT admit site_admin (a field role, not a report viewer)", () => {
    expect(PURCHASE_REPORT_ROLES).not.toContain("site_admin");
  });
});

describe("purchaser-slice visibility (spec 262 U1: manager tier ∪ procurement_manager)", () => {
  it("admits the manager tier and procurement_manager", () => {
    expect(isProcurementManagerTier("project_manager")).toBe(true);
    expect(isProcurementManagerTier("project_director")).toBe(true);
    expect(isProcurementManagerTier("super_admin")).toBe(true);
    expect(isProcurementManagerTier("procurement_manager")).toBe(true);
  });

  it("refuses plain procurement and accounting (staff-performance data)", () => {
    expect(isProcurementManagerTier("procurement")).toBe(false);
    expect(isProcurementManagerTier("accounting")).toBe(false);
  });

  it("PROCUREMENT_MANAGER_ROLES is the same set isProcurementManagerTier checks", () => {
    for (const r of PROCUREMENT_MANAGER_ROLES) expect(isProcurementManagerTier(r)).toBe(true);
  });
});
