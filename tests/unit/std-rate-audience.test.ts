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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canSeeStandardRate } from "@/lib/attendance/std-rate-audience";
import { viewerSeesAllMusterProjects } from "@/lib/attendance/muster-scope";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/auth/role-home";

const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

describe("canSeeStandardRate", () => {
  it("positive set is exactly procurement_manager + super_admin", () => {
    const allowed = ALL_ROLES.filter((r) => canSeeStandardRate(r)).sort();
    expect(allowed).toEqual(["procurement_manager", "super_admin"]);
  });

  it("mirrors the /settings/labor-rates page gate MECHANICALLY", () => {
    // The claimed invariant is "same audience as the labor-rates page". Pin it
    // against that page's actual requireRole literal so the two cannot drift
    // silently (a hand-copied set is where a widened gate hides).
    const src = readFileSync(
      join(process.cwd(), "src", "app", "settings", "labor-rates", "page.tsx"),
      "utf8",
    );
    const m = src.match(/requireRole\(\[([^\]]+)\]\)/);
    expect(m).not.toBeNull();
    const pageGate = Array.from(m![1]!.matchAll(/"([a-z_]+)"/g))
      .map((g) => g[1]!)
      .sort();
    expect(ALL_ROLES.filter((r) => canSeeStandardRate(r)).sort()).toEqual(pageGate);
  });
});

describe("viewerSeesAllMusterProjects", () => {
  it("positive set: exactly the roles can_see_project passes unconditionally, plus the deliberate spec-374 procurement grant", () => {
    // project_manager must NOT be here: muster RLS scopes PM to member/lead
    // projects, and the admin-seam loader re-applies that scoping for PM —
    // widening this set silently widens what a non-member PM can read.
    const allowed = ALL_ROLES.filter((r) => viewerSeesAllMusterProjects(r)).sort();
    expect(allowed).toEqual([
      "procurement",
      "procurement_manager",
      "project_director",
      "super_admin",
    ]);
  });
});
