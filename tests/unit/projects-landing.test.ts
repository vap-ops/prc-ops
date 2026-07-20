import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saProjectsLandingTarget } from "@/lib/nav/projects-landing";

describe("spec 313 U4 — SA โครงการ direct landing", () => {
  it("redirects a site_admin with a current project to its WP list", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: undefined, currentProjectId: "p1" }),
    ).toBe("/projects/p1");
  });

  it("honors the explicit hub request (?view=all)", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: "all", currentProjectId: "p1" }),
    ).toBeNull();
  });

  it("stays on the hub with zero projects", () => {
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: undefined, currentProjectId: null }),
    ).toBeNull();
  });

  it("never redirects other roles", () => {
    for (const role of ["project_manager", "super_admin", "procurement", "project_coordinator"]) {
      expect(saProjectsLandingTarget({ role, view: undefined, currentProjectId: "p1" })).toBeNull();
    }
  });

  // Loop-proofing is the whole risk of this unit: the hub redirect re-fires on
  // every arrival that does not say "all", so an unrecognised view value must NOT
  // be treated as an escape hatch — it has to behave exactly like no value.
  it("treats any non-'all' view value as no escape", () => {
    for (const view of ["", "ALL", "mine", "true", "1"]) {
      expect(saProjectsLandingTarget({ role: "site_admin", view, currentProjectId: "p1" })).toBe(
        "/projects/p1",
      );
    }
  });
});

// The resolver is only half the loop-proofing: the project detail page's back chip
// falls back to the hub, and for a site_admin the BARE hub redirects right back
// here. Pin the role-conditional fallback at the source so the loop can't return.
describe("spec 313 U4 — the back chip cannot loop", () => {
  it("project detail falls back to ?view=all for a site_admin", () => {
    const src = readFileSync(join(process.cwd(), "src/app/projects/[projectId]/page.tsx"), "utf8");
    expect(src).toContain('"/projects?view=all"');
    expect(src).toContain('ctx.role === "site_admin"');
  });
});
