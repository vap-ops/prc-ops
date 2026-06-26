// Spec 65 §A — canonical role allowlists, exported from role-home.ts (the
// recorded role-doctrine home). Replaces 3 local consts + ~11 inline arrays.
import { describe, expect, it } from "vitest";

import {
  ACCOUNTING_ROLES,
  BACK_OFFICE_ROLES,
  PAYROLL_ROLES,
  PM_ROLES,
  SCHEDULE_VIEW_ROLES,
  SITE_STAFF_ROLES,
  SUPPLY_PLAN_ROLES,
  WORKER_ROSTER_ROLES,
  WP_DETAIL_ROLES,
  isManagerRole,
  isReadOnlyWpViewer,
  roleHome,
} from "@/lib/auth/role-home";
import { isBackOfficeRole } from "@/lib/purchasing/back-office";
import { validateLaborEntry } from "@/lib/labor/validate";
import { BILLING_WRITE_ROLES } from "@/lib/accounting/billing-actions";

describe("role sets", () => {
  // Spec 166: beta finance gating — the GL /accounting surface is operator-only
  // (accounting + super_admin) while its numbers are provisional. PM/director
  // were temporarily removed (reverses spec 152's ledger access for beta).
  it("ACCOUNTING_ROLES is accounting + super_admin only (spec 166 beta gate)", () => {
    expect([...ACCOUNTING_ROLES]).toEqual(["accounting", "super_admin"]);
    expect(ACCOUNTING_ROLES).not.toContain("project_manager");
    expect(ACCOUNTING_ROLES).not.toContain("project_director");
  });

  // Spec 152 / ADR 0058: project_director is a see-all project_manager — it
  // joins PM_ROLES (and every set built on it). Appended last so existing
  // order is preserved.
  it("PM_ROLES is project_manager + super_admin + project_director", () => {
    expect([...PM_ROLES]).toEqual(["project_manager", "super_admin", "project_director"]);
  });

  it("SITE_STAFF_ROLES is site_admin + the PM set", () => {
    expect([...SITE_STAFF_ROLES]).toEqual([
      "site_admin",
      "project_manager",
      "super_admin",
      "project_director",
    ]);
  });

  // Spec 101: the back-office write set (suppliers master + purchase/shipment
  // recording) — the PM set PLUS procurement, deliberately NOT site_admin.
  it("BACK_OFFICE_ROLES is the PM set plus procurement, no site_admin", () => {
    expect([...BACK_OFFICE_ROLES]).toEqual([
      "project_manager",
      "super_admin",
      "procurement",
      "project_director",
    ]);
    expect(BACK_OFFICE_ROLES).not.toContain("site_admin");
  });

  it("every PM role lands on /dashboard (consistency with roleHome)", () => {
    // Spec 183 U2: the PM tier lands on ภาพรวม (/dashboard) — the review queue
    // moved off the tab bar into a dashboard card, so the home is the dashboard.
    for (const role of PM_ROLES) expect(roleHome(role)).toBe("/dashboard");
  });
});

// Spec 152 follow-up: isManagerRole is the single predicate for "manager-tier"
// (PM_ROLES membership). It replaces the inline `role === "project_manager" ||
// …` disjunctions scattered across page gates — one place to update when the
// manager set changes (kills the drift surface).
describe("isManagerRole", () => {
  it("is true for exactly the PM_ROLES set", () => {
    for (const role of PM_ROLES) expect(isManagerRole(role)).toBe(true);
  });

  it("is false for non-manager roles", () => {
    for (const role of [
      "site_admin",
      "procurement",
      "project_coordinator",
      "accounting",
      "visitor",
      "contractor",
    ] as const) {
      expect(isManagerRole(role)).toBe(false);
    }
  });
});

// Spec 171: procurement may OPEN the work-package detail screen to raise a
// purchase request — seeing it like a site admin, but read-only everywhere
// except the request. WP_DETAIL_ROLES = SITE_STAFF_ROLES + procurement (kept
// distinct from PURCHASING_ROLES per the "members coincide, meaning differs"
// doctrine). isReadOnlyWpViewer marks procurement as the read-only viewer there.
describe("WP_DETAIL_ROLES (spec 171)", () => {
  it("is SITE_STAFF_ROLES plus procurement", () => {
    expect([...WP_DETAIL_ROLES]).toEqual([
      "site_admin",
      "project_manager",
      "super_admin",
      "project_director",
      "procurement",
    ]);
  });

  it("denies roles outside site-staff + procurement", () => {
    for (const role of [
      "project_coordinator",
      "accounting",
      "hr",
      "technician",
      "subcon_manager",
      "visitor",
      "contractor",
    ] as const) {
      expect(WP_DETAIL_ROLES).not.toContain(role);
    }
  });
});

// Spec 172 Phase C / ADR 0062: procurement gains full DC-onboarding ownership
// (create/update/assign/invite workers + set the pay rate). WORKER_ROSTER_ROLES
// gates /workers + the onboarding RPCs = PM_ROLES + procurement (kept distinct
// from BACK_OFFICE_ROLES per the "members coincide, meaning differs" doctrine —
// this set is "who onboards DC workers", not "who curates contact master data").
describe("WORKER_ROSTER_ROLES (spec 172 Phase C)", () => {
  it("is the PM set plus procurement", () => {
    expect([...WORKER_ROSTER_ROLES]).toEqual([
      "project_manager",
      "super_admin",
      "project_director",
      "procurement",
    ]);
  });

  it("keeps project_director (rides along every gate, file 91 doctrine)", () => {
    expect(WORKER_ROSTER_ROLES).toContain("project_director");
  });

  it("denies field + unserved roles", () => {
    for (const role of [
      "site_admin",
      "project_coordinator",
      "accounting",
      "hr",
      "technician",
      "subcon_manager",
      "visitor",
      "contractor",
    ] as const) {
      expect(WORKER_ROSTER_ROLES).not.toContain(role);
    }
  });
});

// Spec 181 U1: procurement plans supply in the PM's stead — create/add/remove/
// submit a supply plan. SUPPLY_PLAN_ROLES = PM_ROLES + procurement (gates the
// /supply-plan page). Members coincide with WORKER_ROSTER_ROLES today, meaning
// differs ("who plans supply" vs "who onboards DC workers") — kept separate per
// the role-doctrine. Approve/reject stay PD/super (not this set).
describe("SUPPLY_PLAN_ROLES (spec 181)", () => {
  it("is the PM set plus procurement", () => {
    expect([...SUPPLY_PLAN_ROLES]).toEqual([
      "project_manager",
      "super_admin",
      "project_director",
      "procurement",
    ]);
  });

  it("keeps project_director (rides along every gate, file 91 doctrine)", () => {
    expect(SUPPLY_PLAN_ROLES).toContain("project_director");
  });

  it("denies field + unserved roles (incl. site_admin)", () => {
    for (const role of [
      "site_admin",
      "project_coordinator",
      "accounting",
      "hr",
      "technician",
      "subcon_manager",
      "visitor",
      "contractor",
    ] as const) {
      expect(SUPPLY_PLAN_ROLES).not.toContain(role);
    }
  });
});

// Spec 173 U2: procurement reads the project schedule (ตารางงาน) read-only. The
// schedule route + the calendar chip gate on SCHEDULE_VIEW_ROLES = SITE_STAFF_ROLES
// + procurement. project_coordinator is deliberately NOT here (spec 154 excludes it
// from the schedule — it can't follow the chip). Kept distinct from WP_DETAIL_ROLES
// (same membership, different meaning: "who opens the schedule" vs "who opens a WP").
describe("SCHEDULE_VIEW_ROLES (spec 173)", () => {
  it("is SITE_STAFF_ROLES plus procurement", () => {
    expect([...SCHEDULE_VIEW_ROLES]).toEqual([
      "site_admin",
      "project_manager",
      "super_admin",
      "project_director",
      "procurement",
    ]);
  });

  it("excludes project_coordinator (spec 154 schedule exclusion preserved)", () => {
    expect(SCHEDULE_VIEW_ROLES).not.toContain("project_coordinator");
  });

  it("denies other unserved roles", () => {
    for (const role of ["accounting", "hr", "technician", "visitor", "contractor"] as const) {
      expect(SCHEDULE_VIEW_ROLES).not.toContain(role);
    }
  });
});

// Spec 187: procurement gains project-director parity on the payroll surface —
// it views DC payroll AND records DC payments (coherent with procurement already
// owning DC onboarding + the pay rate, spec 172 Phase C). PAYROLL_ROLES =
// PM_ROLES + procurement gates the /payroll page; the record_dc_payment definer
// admits procurement too (migration 20260811000000). Members coincide with
// WORKER_ROSTER_ROLES / SUPPLY_PLAN_ROLES today, meaning differs ("who sees + pays
// DC payroll") — kept separate per the role-doctrine convention.
describe("PAYROLL_ROLES (spec 187)", () => {
  it("is the PM set plus procurement", () => {
    expect([...PAYROLL_ROLES]).toEqual([
      "project_manager",
      "super_admin",
      "project_director",
      "procurement",
    ]);
  });

  it("keeps project_director (rides along every gate, file 91 doctrine)", () => {
    expect(PAYROLL_ROLES).toContain("project_director");
  });

  it("denies field + unserved roles (incl. site_admin — money surface, spec 46)", () => {
    for (const role of [
      "site_admin",
      "project_coordinator",
      "accounting",
      "hr",
      "technician",
      "subcon_manager",
      "visitor",
      "contractor",
    ] as const) {
      expect(PAYROLL_ROLES).not.toContain(role);
    }
  });
});

// rank-2 role-set dedup (architecture audit 2026-06): purchasing/back-office.ts
// re-declared its own BACK_OFFICE_ROLES copy. isBackOfficeRole is the render seam;
// this pins it to the SSOT set so the copy can't silently drift.
describe("isBackOfficeRole (SSOT seam)", () => {
  it("is true for exactly the BACK_OFFICE_ROLES set", () => {
    for (const role of BACK_OFFICE_ROLES) expect(isBackOfficeRole(role)).toBe(true);
  });

  it("is false for roles outside the set (incl. site_admin)", () => {
    for (const role of [
      "site_admin",
      "project_coordinator",
      "accounting",
      "hr",
      "technician",
      "subcon_manager",
      "visitor",
      "contractor",
    ] as const) {
      expect(isBackOfficeRole(role)).toBe(false);
    }
  });
});

// rank-2 role-set dedup: labor/validate.ts re-listed PM_ROLES as a local
// BACKOFFICE_BACKDATE_ROLES set ("who may back-date past the limit"). This pins
// the behaviour to the manager tier — the PM set (incl. project_director)
// bypasses the limit, field roles do not — so the dedup to isManagerRole is safe.
describe("labor back-date allowance follows the PM set", () => {
  const OLD = { workDate: "2026-01-01", workerIds: ["w1"] };
  const TODAY = "2026-06-26"; // ~176 days later, well past the back-date limit

  it("blocks a far back-date for a field role (site_admin)", () => {
    expect(validateLaborEntry(OLD, { today: TODAY, role: "site_admin" })).toMatch(/ย้อนหลัง/);
  });

  it("allows it for every PM-tier role (incl. project_director)", () => {
    for (const role of PM_ROLES) {
      expect(validateLaborEntry(OLD, { today: TODAY, role })).toBeNull();
    }
  });
});

// Operator decision 2026-06-26: project_director (a see-all PM) joins the two
// gates that still excluded it. BILLING_WRITE_ROLES (certify/mark-due/release —
// migration 20260751000000 already widened the RPCs to PD) now = the PM set.
// The drain LINE-ping PM pool likewise uses PM_ROLES at notifications/drain.
describe("BILLING_WRITE_ROLES follows the PM set (incl. project_director)", () => {
  it("equals PM_ROLES and contains project_director", () => {
    expect([...BILLING_WRITE_ROLES]).toEqual([...PM_ROLES]);
    expect(BILLING_WRITE_ROLES).toContain("project_director");
  });

  it("excludes field + non-manager roles (site_admin, procurement, accounting)", () => {
    for (const role of ["site_admin", "procurement", "accounting", "visitor"] as const) {
      expect(BILLING_WRITE_ROLES).not.toContain(role);
    }
  });
});

describe("isReadOnlyWpViewer (spec 171)", () => {
  it("is true only for procurement", () => {
    expect(isReadOnlyWpViewer("procurement")).toBe(true);
  });

  it("is false for full-capability site staff", () => {
    for (const role of SITE_STAFF_ROLES) expect(isReadOnlyWpViewer(role)).toBe(false);
  });
});
