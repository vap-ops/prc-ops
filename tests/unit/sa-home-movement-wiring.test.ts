// Writing failing test first.
//
// Spec 375 U1 — the ORDERING itself is pinned behaviourally in my-work.test.ts.
// This file pins the two things that live in the /sa page, which is a Server
// Component vitest cannot render: that the page actually feeds the movement input
// in, and that the cold rule is rendered once rather than per row.
//
// Comments are stripped first — a comment quoting a symbol must not satisfy a
// presence pin, and a comment quoting a retired literal must not trip an absence
// pin. Occurrence counts are EXACT, not `toContain` and not `>= 2`: a symbol used
// twice still passes a `>= 2` check with one of its uses deleted.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLD_PHOTO_DAYS, PHOTO_WINDOW_DAYS, coldCutoffIso } from "@/lib/sa/my-work";

const SA_HOME = join(process.cwd(), "src/app/sa/page.tsx");

function withoutComments(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function occurrences(src: string, needle: string): number {
  return src.split(needle).length - 1;
}

describe("spec 375 U1 — the /sa page feeds the movement input", () => {
  it("passes both movement fields to buildSaActionList", () => {
    const src = withoutComments(SA_HOME);
    // Dropping either field silently reverts the list to the alphabetical order,
    // and nothing else in the suite would notice.
    expect(occurrences(src, "movement: { lastPhotoByWp, coldBeforeIso }")).toBe(1);
    expect(occurrences(src, "const coldBeforeIso = coldCutoffFromNow();")).toBe(1);
  });

  it("reads photo_logs bounded by the window, tombstones excluded", () => {
    const src = withoutComments(SA_HOME);
    // A tombstone is a REMOVAL (ADR 0015) — counting one as "last photo" would
    // rank a WP whose photo was deleted as freshly worked.
    expect(occurrences(src, 'not("storage_path", "is", null)')).toBe(1);
    // Unbounded, this read grows with project life; the window is what keeps it
    // at ~272 rows instead of the whole 2,704-row table.
    expect(occurrences(src, "coldCutoffFromNow(PHOTO_WINDOW_DAYS)")).toBe(1);
  });

  it("renders the cold rule ONCE, at the first cold row", () => {
    const src = withoutComments(SA_HOME);
    expect(occurrences(src, "noPhotoRuleLabel(")).toBe(1);
    // The `!items[i - 1]?.isCold` guard is what makes it a divider instead of a
    // chip on every cold row. Pinned as the whole condition so deleting just the
    // look-behind reds this.
    expect(src).toContain("it.isCold && !items[i - 1]?.isCold");
  });

  it("states the sort order on the surface", () => {
    const src = withoutComments(SA_HOME);
    // An unexplained order is one the field cannot trust; the label is the
    // difference between "sorted" and "shuffled" to the person reading it.
    expect(occurrences(src, "MY_WORK_SORT_NOTE")).toBe(2);
  });
});

// Spec 375 U2 was REVERTED 2026-07-30 (operator: "I don't see the point of putting
// my project on top, redundant nav with bottom menu"). It solved a problem that did
// not exist, and all three of my supporting claims were wrong:
//
//   • The SA's โครงการ tab points at /projects, and **spec 313 U4 already redirects
//     a site_admin from there straight to her project hub** (`saProjectsLandingTarget`;
//     `?view=all` escapes). One tap, shipped since 2026-07 — verified in-browser.
//   • "395 of ~810 visits leak sideways, a two-tap detour" MISREAD telemetry: an RSC
//     redirect logs a `route_view` for BOTH /projects and the hub, so one tap emits
//     two events.
//   • "/projects is a 4-item list, 3 of them empty" was dev-preview's SUPER_ADMIN
//     view — every real SA has 1 membership and sees exactly ONE project.
//
// This absence pin exists so the card cannot be re-added on the same bad premise.
describe("spec 375 U2 — the project card stays REVERTED", () => {
  it("renders no project card on the home", () => {
    const src = withoutComments(SA_HOME);
    expect(occurrences(src, "HomeProjectCard")).toBe(0);
    expect(occurrences(src, "buildHomeProjectCard")).toBe(0);
  });
});

describe("spec 375 U1 — the cold cutoff", () => {
  it("returns the ISO instant N days before the given clock", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    expect(coldCutoffIso(now, 14)).toBe("2026-07-15T12:00:00.000Z");
    expect(coldCutoffIso(now)).toBe(coldCutoffIso(now, COLD_PHOTO_DAYS));
  });

  it("keeps the read window WIDER than the cold threshold", () => {
    // If the window ever narrowed to the threshold or below, a WP whose only
    // photo fell between the two would be read as having NO photo and be
    // mislabelled cold — the rule would then assert something false about it.
    expect(PHOTO_WINDOW_DAYS).toBeGreaterThan(COLD_PHOTO_DAYS);
  });
});
