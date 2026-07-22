// Writing failing test first.
//
// Spec 337 U5 — the SEAM, which the two halves' own tests do not cover.
// `defect-deep-link.test.ts` pins the module and `report-defect-control.test.tsx`
// pins the component, but nothing pinned the WP detail page WIRING them together:
// swap `sp[DEFECT_PARAM]` for `sp.from` and every other test stays green while
// the deep link silently dies. Fresh-eyes review 2026-07-22 caught this.
//
// Second pin here: the door's effective AUDIENCE. The list computes
// `!isReadOnlyWpViewer(role)` and leans on `canOpen` (= WP_DETAIL_ROLES) for the
// rest, so the audience is a COMPOSITION rather than a written list. That
// reasoning is load-bearing, so it is asserted over the real role sets instead
// of living in a comment.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SITE_STAFF_ROLES, WP_DETAIL_ROLES, isReadOnlyWpViewer } from "@/lib/auth/role-home";

const PAGE = readFileSync(
  "src/app/projects/[projectId]/work-packages/[workPackageId]/page.tsx",
  "utf8",
);

describe("WP detail page — defect deep-link wiring", () => {
  it("reads the param through DEFECT_PARAM and feeds it to the control", () => {
    // Both ends of the seam, and the param read keyed off the shared constant
    // rather than a literal (so the door's key and this reader cannot drift).
    expect(PAGE).toContain("sp[DEFECT_PARAM]");
    expect(PAGE).toContain("initialOpen={shouldOpenDefectSheet(defect)}");
    // …and the literal key is NOT re-hardcoded anywhere in the read path.
    expect(PAGE).not.toContain("sp.defect");
    expect(PAGE).not.toContain('sp["defect"]');
  });

  it("keeps the control's render gate the only thing that admits the sheet", () => {
    // ?defect=1 must never open a sheet the viewer wasn't already entitled to:
    // the control is mounted ONLY on a complete WP for a non-read-only viewer,
    // so the param can widen nothing.
    expect(PAGE).toContain('wp.status === "complete" && !readOnly');
  });
});

describe("defect door audience", () => {
  // The list renders a door when `canReportDefect` AND the row is openable.
  // canOpen is WP_DETAIL_ROLES membership (project page), canReportDefect is
  // "not the read-only WP viewer" — the intersection must be exactly the site
  // staff, i.e. the roles the reopen RPC accepts.
  const effectiveAudience = WP_DETAIL_ROLES.filter((r) => !isReadOnlyWpViewer(r));

  it("resolves to exactly SITE_STAFF_ROLES", () => {
    expect([...effectiveAudience].sort()).toEqual([...SITE_STAFF_ROLES].sort());
  });

  it("admits neither procurement tier", () => {
    expect(effectiveAudience).not.toContain("procurement");
    expect(effectiveAudience).not.toContain("procurement_manager");
  });
});
