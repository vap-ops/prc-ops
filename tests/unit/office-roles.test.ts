// tests/unit/office-roles.test.ts
// Writing failing test first.
//
// Spec 342 U1.2 — the field/office role partition, lifted out of the
// registration-decision client component so /settings/roles can mint from it,
// plus the hint→role parse (D6: declared_role_hint holds a role KEY for
// invited applicants, legacy prose otherwise).

import { describe, expect, it } from "vitest";
import {
  FIELD_ROLE_OPTIONS,
  OFFICE_ROLE_OPTIONS,
  invitedRoleFromHint,
} from "@/lib/register/office-roles";
import { STAFF_ONBOARDABLE_ROLES } from "@/lib/auth/role-home";

describe("office-roles partition", () => {
  it("field options are exactly technician + site_admin", () => {
    expect(FIELD_ROLE_OPTIONS).toEqual(["technician", "site_admin"]);
  });

  it("field + office partition STAFF_ONBOARDABLE_ROLES exactly (no loss, no overlap)", () => {
    const union = [...FIELD_ROLE_OPTIONS, ...OFFICE_ROLE_OPTIONS];
    expect([...union].sort()).toEqual([...STAFF_ONBOARDABLE_ROLES].sort());
    expect(new Set(union).size).toBe(union.length);
  });
});

describe("invitedRoleFromHint", () => {
  it("parses an onboardable role key", () => {
    expect(invitedRoleFromHint("procurement")).toBe("procurement");
    expect(invitedRoleFromHint(" legal ")).toBe("legal");
  });

  it("rejects legacy prose, blanks, and non-onboardable roles", () => {
    expect(invitedRoleFromHint("จัดซื้อ")).toBeNull();
    expect(invitedRoleFromHint("")).toBeNull();
    expect(invitedRoleFromHint(null)).toBeNull();
    expect(invitedRoleFromHint(undefined)).toBeNull();
    // in the DB guard's 13-role list but NOT onboardable — must not prefill
    expect(invitedRoleFromHint("project_director")).toBeNull();
    expect(invitedRoleFromHint("super_admin")).toBeNull();
  });
});
