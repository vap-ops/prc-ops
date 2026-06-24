// Writing failing test first.
//
// Operator: a site_admin "can't normally work on more than 1 project at a time",
// so a site_admin who belongs to exactly ONE project should LAND on that project
// (/projects/[id]) instead of the /sa daily home. With 0 or many projects they
// keep /sa (the home that spans their work / explains the empty state). Every
// other role ignores the project list and lands on its roleHome.

import { describe, expect, it } from "vitest";

import { resolveHomePath } from "@/lib/auth/resolve-home";

describe("resolveHomePath (single-project site_admin lands on their project)", () => {
  it("sends a single-project site_admin straight to that project", () => {
    expect(resolveHomePath("site_admin", ["p1"])).toBe("/projects/p1");
  });

  it("keeps a multi-project site_admin on the /sa daily home", () => {
    expect(resolveHomePath("site_admin", ["p1", "p2"])).toBe("/sa");
  });

  it("keeps a no-project site_admin on /sa (the empty-state home)", () => {
    expect(resolveHomePath("site_admin", [])).toBe("/sa");
  });

  it("ignores the project list for non-site_admin roles (roleHome wins)", () => {
    expect(resolveHomePath("project_manager", ["p1"])).toBe("/dashboard");
    expect(resolveHomePath("procurement", ["p1"])).toBe("/requests");
    expect(resolveHomePath("super_admin", ["p1"])).toBe("/dashboard");
  });
});
