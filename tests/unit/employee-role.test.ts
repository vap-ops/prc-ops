// Writing failing test first.
//
// Spec 291 U2: the /profile employee-ID card renders for employees only — an
// external-facing / pre-role account (client viewer, contractor partner,
// unonboarded visitor) has no employee identity to show. EXTERNAL_ROLES names
// that small carve-out; isEmployeeRole is its complement, the single predicate
// the profile page branches on. Deliberately NOT built by hardcoding the full
// UserRole enum — only the external set is enumerated, so a future enum add
// defaults to "employee" without touching this file.

import { describe, expect, it } from "vitest";

import { EXTERNAL_ROLES, isEmployeeRole } from "@/lib/auth/role-home";

describe("EXTERNAL_ROLES", () => {
  it("is exactly client, contractor, visitor", () => {
    expect([...EXTERNAL_ROLES].sort()).toEqual(["client", "contractor", "visitor"]);
  });
});

describe("isEmployeeRole", () => {
  it("is true for an internal role (site_admin)", () => {
    expect(isEmployeeRole("site_admin")).toBe(true);
  });

  it("is false for every external role", () => {
    expect(isEmployeeRole("client")).toBe(false);
    expect(isEmployeeRole("contractor")).toBe(false);
    expect(isEmployeeRole("visitor")).toBe(false);
  });
});
