// Writing failing test first.
//
// Spec 363 U3 (D4): แรงงาน leaves the SA's WP-detail tab set. It does NOT leave
// the app — spec 306 U5a's derive_muster_labor writes labor_logs once close-day
// adoption starts, and the manager tier is the only audience that acts on that
// money. Plain `procurement` also keeps it: spec 171 gave them the read-only
// labour history, and spec 363 §7 lists "any change to readOnly rendering" as a
// non-goal.
//
// The positive set is asserted EXACTLY, over the complete role domain
// (USER_ROLE_LABEL is a Record<user_role>, so adding an enum value trips its own
// guard and then this one). A hand-typed list of "roles that can't" would silently
// admit the next role someone adds.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showsLaborTab } from "@/lib/work-packages/wp-detail-labor-tab";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

describe("showsLaborTab", () => {
  it("admits exactly the manager tier plus the read-only viewer", () => {
    expect(ALL_ROLES.filter(showsLaborTab).sort()).toEqual(
      ["procurement", "project_director", "project_manager", "super_admin"].sort(),
    );
  });

  it("hides the tab from site_admin — the point of the unit", () => {
    expect(showsLaborTab("site_admin")).toBe(false);
  });

  it("hides the tab from procurement_manager, who has SA capture parity", () => {
    // Spec 348 U4 cleared her readOnly flag; she captures like an SA, so she gets
    // the SA's tab set. Plain `procurement` is the oversight viewer and keeps it.
    expect(showsLaborTab("procurement_manager")).toBe(false);
    expect(showsLaborTab("procurement")).toBe(true);
  });
});

// The predicate above is only worth anything if the page actually calls it. The
// tab array lives in Server Component JSX that vitest cannot render, so this pins
// the wiring by source — comments stripped first, so a comment naming the helper
// cannot satisfy the pin on its own.
describe("WP detail page — the labour tab is gated by showsLaborTab", () => {
  it("calls the predicate rather than rendering the tab unconditionally", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx"),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Import PLUS a real call site — a bare import would satisfy a single toContain.
    expect(src.split("showsLaborTab").length - 1).toBeGreaterThanOrEqual(2);
    expect(src).toContain("showsLaborTab(ctx.role)");
  });
});
