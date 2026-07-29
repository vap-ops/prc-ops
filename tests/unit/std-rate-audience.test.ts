// Spec 374 U1 — who may see the firm's standard level rate on the attendance
// calendar. MIRRORS the /settings/labor-rates page gate (procurement_manager +
// super_admin): the standard is money master data with an audience NARROWER
// than the calendar page's own WORKER_ROSTER_ROLES gate, so the loader must
// withhold it for everyone else (the /workers page already applies this
// narrower-audience rule for its confirm preview).
//
// Iterates the COMPLETE role domain via USER_ROLE_LABEL (a Record<UserRole,…> —
// an enum add trips its own exhaustiveness guard) and pins the EXACT positive
// set, so widening OR narrowing reds this test in both directions.
import { describe, expect, it } from "vitest";

import { canSeeStandardRate } from "@/lib/attendance/std-rate-audience";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/auth/role-home";

describe("canSeeStandardRate", () => {
  it("positive set is exactly procurement_manager + super_admin", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    const allowed = all.filter((r) => canSeeStandardRate(r)).sort();
    expect(allowed).toEqual(["procurement_manager", "super_admin"]);
  });
});
