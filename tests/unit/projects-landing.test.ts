import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saProjectsLandingTarget } from "@/lib/nav/projects-landing";
import { safeBackHref } from "@/lib/nav/back-href";

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
// here.
describe("spec 313 U4 — the back chip cannot loop", () => {
  // Behavioural half: the fallback must survive sanitising AND be an escape the
  // resolver honours. Together those are what actually close the loop — a value
  // safeBackHref rejected, or one the resolver still redirected away from, would
  // each re-open it.
  it("the ?view=all fallback survives sanitising AND is a real escape", () => {
    expect(safeBackHref(undefined, "/projects?view=all")).toBe("/projects?view=all");
    expect(
      saProjectsLandingTarget({ role: "site_admin", view: "all", currentProjectId: "p1" }),
    ).toBeNull();
  });

  // Source half: that the page WIRES that fallback to the site_admin branch.
  // Pinned as ONE contiguous expression on purpose — asserting the two fragments
  // separately passes trivially, because `ctx.role === "site_admin"` already
  // appears elsewhere in this file (the canPlanTomorrow flag) and would satisfy
  // the assertion even if the back chip never mentioned the role at all.
  it("project detail wires the fallback to the site_admin branch", () => {
    const src = readFileSync(join(process.cwd(), "src/app/projects/[projectId]/page.tsx"), "utf8");
    const normalised = src.replace(/\s+/g, " ");
    expect(normalised).toContain(
      'safeBackHref( from, ctx.role === "site_admin" ? "/projects?view=all" : "/projects", )'.replace(
        /\s+/g,
        " ",
      ),
    );
  });
});
