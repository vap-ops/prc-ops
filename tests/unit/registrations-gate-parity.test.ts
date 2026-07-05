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

  it("the SA read view gates on site_admin only (read-only, never the approver set)", () => {
    const saQueue = read("sa", "registrations", "page.tsx");
    const saDetail = read("sa", "registrations", "[id]", "page.tsx");
    expect(saQueue).toContain('requireRole(["site_admin"])');
    expect(saDetail).toContain('requireRole(["site_admin"])');
    // The SA pages must never import the decision control (read-only surface).
    expect(saQueue).not.toContain("RegistrationDecision");
    expect(saDetail).not.toContain("RegistrationDecision");
  });
});
