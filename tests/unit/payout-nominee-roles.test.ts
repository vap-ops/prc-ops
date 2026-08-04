// Writing failing test first.
//
// Spec 395 §6 — the payout-nominee role set, and the two shipped pages that were
// restating it inline.
//
// §6's finding, verbatim: "No shared constant for this set exists today, and the
// instruction 'don't restate the list' is currently unfollowable." `STAFF_APPROVAL_ROLES`
// is the same set MINUS plain `procurement`; `BACK_OFFICE_ROLES` / `WORKER_ROSTER_ROLES` /
// `PAYROLL_ROLES` all additionally include `project_manager`. So neither could be
// borrowed, and both `/settings/payout-nominees` pages passed the four literals straight
// to `requireRole` — two copies that drift independently from the DEFINER RPCs they gate.
//
// ⚠️ This set must equal the LIVE nominee-RPC membership
// ('procurement_manager','project_director','super_admin','procurement'). A page gate
// wider than the RPC produces the affordance-then-refuse defect this repo has shipped
// before (spec 187's `recordWagePayment`); a page gate narrower hides work from someone
// the database would have accepted.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PAYOUT_NOMINEE_ROLES, STAFF_APPROVAL_ROLES } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

const read = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const LIST_PAGE = read("src/app/settings/payout-nominees/page.tsx");
const EDIT_PAGE = read("src/app/settings/payout-nominees/edit/page.tsx");

describe("PAYOUT_NOMINEE_ROLES", () => {
  it("is EXACTLY the live nominee-RPC membership", () => {
    expect([...PAYOUT_NOMINEE_ROLES].sort()).toEqual(
      ["procurement", "procurement_manager", "project_director", "super_admin"].sort(),
    );
  });

  // Iterating the exhaustive domain, not a hand-typed "everyone else" list: a role
  // added to the enum later must not silently acquire nominee access without redding
  // this test. (The hand-list variant of this guard is what let spec 348 U5 miss two
  // roles.)
  it("admits no other role in the whole user_role domain", () => {
    const ALL = Object.keys(USER_ROLE_LABEL) as UserRole[];
    const admitted = ALL.filter((r) => PAYOUT_NOMINEE_ROLES.includes(r)).sort();
    expect(admitted).toEqual(
      ["procurement", "procurement_manager", "project_director", "super_admin"].sort(),
    );
  });

  // The relationship §6 names, pinned so a future edit to either set is deliberate.
  it("is STAFF_APPROVAL_ROLES plus plain procurement — nothing else", () => {
    const extra = PAYOUT_NOMINEE_ROLES.filter((r) => !STAFF_APPROVAL_ROLES.includes(r));
    expect(extra).toEqual(["procurement"]);
    for (const r of STAFF_APPROVAL_ROLES) {
      expect(PAYOUT_NOMINEE_ROLES, `${r} must stay admitted`).toContain(r);
    }
  });
});

describe("the shipped nominee pages use the constant, not their own copy", () => {
  for (const [name, src] of [
    ["/settings/payout-nominees", LIST_PAGE],
    ["/settings/payout-nominees/edit", EDIT_PAGE],
  ] as const) {
    it(`${name} gates on PAYOUT_NOMINEE_ROLES`, () => {
      // >=2 = the import PLUS a real use; a bare toContain is satisfied by the import.
      expect(src.split("PAYOUT_NOMINEE_ROLES").length - 1).toBeGreaterThanOrEqual(2);
    });

    it(`${name} no longer restates the role literals inline`, () => {
      // Bare, not quote-wrapped: a revert to a bare identifier or different quoting
      // must still red. The gate is the only place these strings appeared.
      expect(src).not.toContain("procurement_manager");
      expect(src).not.toContain("project_director");
    });
  }
});
