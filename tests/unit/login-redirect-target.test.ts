// spec 263 follow-up — the already-signed-in branch of /login. A user who
// is already authenticated and arrives with a valid same-origin ?next is
// sent THERE; otherwise (absent/invalid next) behavior is byte-identical to
// today — roleHome(role). Pure decision, extracted so it is unit-testable
// without mocking Supabase auth.

import { describe, it, expect } from "vitest";
import { loginRedirectTarget } from "@/lib/auth/login-redirect-target";
import { roleHome } from "@/lib/auth/role-home";

describe("loginRedirectTarget — already-signed-in destination", () => {
  it("returns a valid same-origin next over roleHome", () => {
    expect(loginRedirectTarget("/register/technician", "visitor")).toBe("/register/technician");
    expect(loginRedirectTarget("/register/technician", "site_admin")).toBe("/register/technician");
  });

  it("falls back to roleHome when next is absent (DEFAULT unchanged)", () => {
    expect(loginRedirectTarget(null, "site_admin")).toBe(roleHome("site_admin"));
    expect(loginRedirectTarget(undefined, "visitor")).toBe(roleHome("visitor"));
    expect(loginRedirectTarget("", "procurement")).toBe(roleHome("procurement"));
  });

  it("falls back to roleHome when next is an unsafe open-redirect (DEFAULT unchanged)", () => {
    expect(loginRedirectTarget("//evil.com", "site_admin")).toBe(roleHome("site_admin"));
    expect(loginRedirectTarget("https://evil.com", "visitor")).toBe(roleHome("visitor"));
    expect(loginRedirectTarget("/\\evil.com", "visitor")).toBe(roleHome("visitor"));
  });

  it("visitor with no next still lands on /coming-soon exactly as before", () => {
    expect(loginRedirectTarget(null, "visitor")).toBe("/coming-soon");
  });
});
