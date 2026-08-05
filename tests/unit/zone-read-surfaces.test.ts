// Spec 392 U3a — the zone READ surfaces: the chip on a work package, the
// zone × หมวดงาน rollup on the project page, and the work-list's zone filter.
//
// Both pages are async Server Components vitest cannot render, so the wiring is
// pinned by comment-stripped source scans with EXACT occurrence counts (the
// house idiom — a bare `toContain` is satisfied by the import line alone, and a
// doc comment quoting the symbol stands in for a deleted call). The BEHAVIOUR
// lives in the pure builders and the client components, which have their own
// tests; what is asserted here is that the pages actually call them, with the
// gates and the ?from intact.
//
// The gate this file exists to keep honest: `project_zones` SELECT is
// `procurement/procurement_manager OR can_see_project`, and `can_see_project`
// is live-FALSE for `technician` on every arm. So every surface here is gated
// by the DATA — a zone row that came back through RLS — never by a role list
// that could drift away from the policy. The one exception is the chip's LINK,
// which is narrower still: /projects/:id/zones is requireRole(PM_ROLES).

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function strip(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const wpPage = strip(
  readFileSync("src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx", "utf8"),
);
const projectPage = strip(readFileSync("src/app/projects/[projectId]/page.tsx", "utf8"));
const projectLoader = strip(readFileSync("src/lib/projects/load-detail.ts", "utf8"));

describe("spec 392 U3a — the WP-detail zone chip", () => {
  it("reads the zone THROUGH RLS, as an embed on the read it already runs", () => {
    // The embed IS the gate: a reader the policy withholds the row from gets
    // null and the chip renders nothing. Reading zone_id and then naming a zone
    // from some other source would show a name they may not have.
    expect(count(wpPage, "project_zones ( code, name )")).toBe(1);
    expect(count(wpPage, "pre.project_zones ?? null")).toBe(1);
  });

  it("renders the chip on BOTH the งาน and the งานย่อย detail", () => {
    // import + the group branch + the leaf branch. zone_id is a column on every
    // work_packages row, so a zone set on a group must not be write-only.
    expect(count(wpPage, "WpZoneChip")).toBe(3);
  });

  it("links to the map only for the role set that can OPEN it", () => {
    // isPlanner is isManagerRole = PM_ROLES, which is exactly the zones page's
    // requireRole. Anyone else gets href=null and an inert chip instead of a
    // link that redirects them off the page they are standing on.
    expect(count(wpPage, "const zoneChipHref = isPlanner")).toBe(1);
  });

  it("threads its own path as ?from — the zones route is multi-parent now", () => {
    expect(
      count(
        wpPage,
        "withBackFrom(zonesHref(projectId), workPackageHref(projectId, workPackageId))",
      ),
    ).toBe(1);
    // and no second, un-threaded door to the same route may sit beside it.
    expect(count(wpPage, "zonesHref(")).toBe(1);
  });
});

describe("spec 392 U3a — the project-page rollup", () => {
  it("loads the project's zones in the SAME wave as the work packages", () => {
    // A serial layer here lands on the app's highest-traffic mobile route.
    expect(count(projectLoader, 'from("project_zones")')).toBe(1);
    // Anchored on its neighbour rather than on the bare word: `parent_zone_id`
    // contains `zone_id`, so a loose needle counts the zones read's own columns
    // and passes with the work-package column gone.
    expect(count(projectLoader, 'category_id, zone_id"')).toBe(1);
  });

  it("builds and renders the grid, gated on the data rather than on a role", () => {
    expect(count(projectPage, "buildZoneRollup")).toBe(2); // import + call
    expect(count(projectPage, "ZoneRollupGrid")).toBe(2); // import + render
    // No role predicate stands between the reader and the grid: `zones` is
    // empty for anyone RLS withholds them from, and the component returns null.
    expect(projectPage).not.toContain("canSeeZones");
  });

  it("feeds the work-list its zone axis and its filter options", () => {
    // Twice, and both matter: once into buildZoneRollup's input and once onto
    // the list row. Dropping either leaves one surface reporting every งาน as
    // unplaced while the other reports them correctly.
    expect(count(projectPage, "zoneId: wp.zone_id")).toBe(2);
    expect(count(projectPage, "zones={zoneFilterOptions}")).toBe(1);
    // Both the grid rows and the filter chips order through buildZoneList, so
    // the map, the list and this page cannot disagree about which zone is where.
    expect(count(projectPage, "buildZoneList(zones, {})")).toBe(1);
  });
});
