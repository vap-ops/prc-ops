import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_LANDING_ROLES, saProjectsLandingTarget } from "@/lib/nav/projects-landing";
import { safeBackHref } from "@/lib/nav/back-href";
import { PROJECT_VIEW_ROLES } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

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

  // Source half: that the page WIRES that fallback to the redirecting roles.
  // Pinned as ONE contiguous expression on purpose — asserting the two fragments
  // separately passes trivially, because `ctx.role` already appears throughout
  // this file (the canPlanTomorrow flag and every gate predicate) and would
  // satisfy the assertion even if the back chip never mentioned the role at all.
  // Spec 376 U5: the branch reads the SET, not the site_admin literal — site_owner
  // now redirects too, and a literal here would have left ITS back chip looping.
  it("project detail wires the fallback to the landing-role branch", () => {
    const src = readFileSync(join(process.cwd(), "src/app/projects/[projectId]/page.tsx"), "utf8");
    const normalised = src.replace(/\s+/g, " ");
    expect(normalised).toContain(
      'safeBackHref( from, PROJECT_LANDING_ROLES.includes(ctx.role) ? "/projects?view=all" : "/projects", )'.replace(
        /\s+/g,
        " ",
      ),
    );
  });
});

// Spec 376 U5 (D2) — the SA's direct landing generalizes to a NAMED set, because
// site_owner homes on /projects and a site owner belongs to one site, exactly like
// the SA. Everything the SA's redirect already carries — the ?view=all escape, the
// strict comparison, the zero-project safe stop — is inherited by set membership,
// so there is no second redirect path to keep in step.
//
// Pinned over the EXHAUSTIVE role domain as an EXACT positive set (USER_ROLE_LABEL
// is a Record<UserRole>, so a new enum value reds here) rather than a hand-listed
// denial loop, which silently misses the next enum value — the spec-348-U5 lesson.
// Membership here is not cosmetic: it decides whether a role's arrival at /projects
// is a REDIRECT, and every ?view=all pin in the hub keys off the same set.
describe("PROJECT_LANDING_ROLES (spec 376 U5)", () => {
  const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

  it("is exactly site_admin + site_owner over the whole role domain", () => {
    expect(ALL_ROLES.filter((r) => PROJECT_LANDING_ROLES.includes(r)).sort()).toEqual(
      ["site_admin", "site_owner"].sort(),
    );
  });

  // A role that gets redirected INTO a project must be able to open the hub it is
  // being redirected away from — otherwise the ?view=all escape lands on a bounce
  // and the role has no way to see its other projects.
  it("every member is admitted to the /projects gate it redirects from", () => {
    for (const role of PROJECT_LANDING_ROLES) {
      expect(PROJECT_VIEW_ROLES, role).toContain(role);
    }
  });

  it("redirects a site_owner with a current project to its WP list", () => {
    expect(
      saProjectsLandingTarget({ role: "site_owner", view: undefined, currentProjectId: "p9" }),
    ).toBe("/projects/p9");
  });

  it("honors ?view=all and the zero-project stop for site_owner too", () => {
    expect(
      saProjectsLandingTarget({ role: "site_owner", view: "all", currentProjectId: "p9" }),
    ).toBeNull();
    expect(
      saProjectsLandingTarget({ role: "site_owner", view: undefined, currentProjectId: null }),
    ).toBeNull();
  });

  // The loop-proofing is per-ROLE, not per-set: a member added without the strict
  // comparison would treat a truncated query string as an escape.
  it("treats any non-'all' view value as no escape for site_owner", () => {
    for (const view of ["", "ALL", "mine", "true", "1"]) {
      expect(saProjectsLandingTarget({ role: "site_owner", view, currentProjectId: "p9" })).toBe(
        "/projects/p9",
      );
    }
  });

  // The hub's own ?view=all pinning (filter chips, search form, clear ×) keys off
  // the same set — a literal there would re-fire the redirect on the first chip tap.
  it("the hub pins ?view=all off the set, not a site_admin literal", () => {
    const src = readFileSync(join(process.cwd(), "src/app/projects/page.tsx"), "utf8");
    const normalised = src.replace(/\s+/g, " ");
    expect(normalised).toContain("PROJECT_LANDING_ROLES.includes(ctx.role)");
  });

  // The hub picks its kicker + desktop strip with its OWN role ladder, whose LAST
  // arm is the SA's. site_owner is not site staff: falling into that arm would hand
  // it SA_HUB_NAV, whose /sa, /team and /requests are all doors it cannot open —
  // "never promote a role's home without its chrome" (the 313 U6 lesson) applies to
  // the page's ladder as much as to hubNavForRole, and nav-law-strip-superset only
  // covers the latter. Pinned as contiguous ternary arms so the ORDER is asserted:
  // the site_owner arm must sit ahead of the SA fallback, not merely exist.
  it("the hub gives site_owner its own kicker + strip, ahead of the SA fallback", () => {
    const src = readFileSync(join(process.cwd(), "src/app/projects/page.tsx"), "utf8");
    const normalised = src.replace(/\s+/g, " ");
    expect(normalised).toContain(": isSiteOwner ? USER_ROLE_LABEL.site_owner :");
    expect(normalised).toContain(": isSiteOwner ? SITE_OWNER_HUB_NAV :");
    expect(normalised).toContain('const isSiteOwner = ctx.role === "site_owner";');
  });
});
