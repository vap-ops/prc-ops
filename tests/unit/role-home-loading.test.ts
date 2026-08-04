// UX-audit 2026-08 gap G8 (finding F-011), generalized: a role's HOME must never
// paint a dead frame on first load. /procurement — a role home with three awaited
// RLS reads in its Server Component tree — had no loading.tsx, no Suspense, no
// root fallback, so its daily audience (633 views/14d) stared at a frozen page.
//
// The rule, derived rather than hand-listed (the house allowlist lesson: a
// hand-typed route list silently misses the next role): EVERY route returned by
// roleHome() over the COMPLETE user_role domain must sit under a loading.tsx
// boundary (its own segment or an ancestor segment — Next.js applies the nearest
// boundary above the segment). USER_ROLE_LABEL is a Record<user_role, string>,
// so a new enum value fails ITS exhaustiveness first, then lands here, and the
// new role's home gets checked automatically. Tripping on a new role home is the
// desired behaviour — copy src/app/sa/loading.tsx (a one-line <PageSkeleton />).
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const APP = join(process.cwd(), "src", "app");

/**
 * Nearest-boundary check: the route's own dir or any ancestor under src/app
 * (Next.js applies the closest loading.tsx above the segment; /accounting/review
 * correctly inherits src/app/accounting/loading.tsx). Declared limits, both
 * fine TODAY and to revisit if the app's conventions change: ① a future root
 * src/app/loading.tsx would satisfy every home — that is a REAL boundary (a
 * root skeleton genuinely ends the dead-frame class), not a vacuity, but it
 * would also mask a deleted per-home skeleton, so prefer per-segment files;
 * ② URL segments are mapped 1:1 to filesystem dirs — the app has NO route
 * groups today (verified 2026-08-04: zero `(group)` dirs under src/app); a
 * grouped home would need this walk taught about groups; ③ only .tsx is
 * checked (the codebase is 100% tsx).
 */
function hasLoadingBoundary(route: string): boolean {
  const segments = route.split("/").filter(Boolean);
  for (let depth = segments.length; depth >= 0; depth--) {
    if (existsSync(join(APP, ...segments.slice(0, depth), "loading.tsx"))) return true;
  }
  return false;
}

describe("role-home loading coverage (UX-audit G8)", () => {
  const roles = Object.keys(USER_ROLE_LABEL) as UserRole[];
  const homes = [...new Set(roles.map((role) => roleHome(role)))].sort();

  it("derives at least the known role-home set (the scan is not vacuous)", () => {
    // A refactor that empties USER_ROLE_LABEL or breaks roleHome would make the
    // loop below pass over nothing — pin a floor so zero-scanned is a failure.
    expect(roles.length).toBeGreaterThanOrEqual(17);
    expect(homes.length).toBeGreaterThanOrEqual(8);
  });

  it("every role home renders a loading boundary (own segment or ancestor)", () => {
    const uncovered = homes.filter((home) => !hasLoadingBoundary(home));
    expect(
      uncovered,
      `role home(s) with NO loading.tsx anywhere above them — first paint is a dead frame; ` +
        `fix: copy src/app/sa/loading.tsx into the segment: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });
});
