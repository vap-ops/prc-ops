// Spec 263 U3 / spec 264 G4 — the back-office approval-queue gate parity. Named
// anti-pattern this guards against (payroll's original bug, spec 187/252, also
// guarded for spec 262 in purchase-reports-export-gate.test.ts): the page renders
// an affordance for a role set the server action then refuses. The queue list,
// its review detail, and both server actions MUST all gate on the exact same
// STAFF_APPROVAL_ROLES constant (renamed from spec 263's TECHNICIAN_APPROVAL_ROLES;
// membership unchanged) — a source-scan pin, so a future edit to one call site
// can't silently drift from the others (or from the approve_staff_registration
// RPC's inline literal gate, which this constant mirrors — role-sets.test.ts pins
// that membership).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP = join(process.cwd(), "src", "app");
const read = (...segs: string[]) => readFileSync(join(APP, ...segs), "utf8");

describe("staff-registration approval gate parity (spec 263 U3 / spec 264 G4)", () => {
  it("the queue list page gates on STAFF_APPROVAL_ROLES", () => {
    expect(read("registrations", "page.tsx")).toContain("requireRole(STAFF_APPROVAL_ROLES)");
  });

  it("the review detail page gates on STAFF_APPROVAL_ROLES (same as the queue)", () => {
    expect(read("registrations", "[id]", "page.tsx")).toContain(
      "requireRole(STAFF_APPROVAL_ROLES)",
    );
  });

  it("approveStaffRegistration gates on STAFF_APPROVAL_ROLES via requireActionRole", () => {
    const actions = read("registrations", "actions.ts");
    expect(actions).toContain("requireActionRole(STAFF_APPROVAL_ROLES)");
  });

  // Spec 348 U2 / ADR 0084: the SA read view gains procurement_manager (SA parity)
  // via SA_REGISTRATION_VIEW_ROLES = [site_admin, procurement_manager]. The
  // load-bearing invariant this test protects is UNCHANGED: the SA view stays
  // READ-ONLY (never renders the decision control), so no affordance-then-refuse
  // even though procurement_manager is an approver elsewhere. It is also NOT the
  // full approver surface — super_admin/PD are absent here (they use /registrations),
  // pinned by role-sets.test.ts.
  it("the SA read view gates on SA_REGISTRATION_VIEW_ROLES, read-only (never the decision control)", () => {
    const saQueue = read("sa", "registrations", "page.tsx");
    const saDetail = read("sa", "registrations", "[id]", "page.tsx");
    expect(saQueue).toContain("requireRole(SA_REGISTRATION_VIEW_ROLES)");
    expect(saDetail).toContain("requireRole(SA_REGISTRATION_VIEW_ROLES)");
    // Load-bearing: the SA pages must never import the decision control — the
    // surface is read-only, so admitting an approver (procurement_manager) grants
    // no approve affordance here.
    expect(saQueue).not.toContain("RegistrationDecision");
    expect(saDetail).not.toContain("RegistrationDecision");
    // And it must NOT be silently widened to the full approver set.
    expect(saQueue).not.toContain("STAFF_APPROVAL_ROLES");
    expect(saDetail).not.toContain("STAFF_APPROVAL_ROLES");
  });
});
