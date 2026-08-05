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
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tabsForRole } from "@/components/features/chrome/bottom-tab-bar";
import { hubNavForRole } from "@/components/features/chrome/hub-nav";
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

// UX-audit G8, the rest of it (2026-08-06). The block above covers role HOMES —
// the set `roleHome()` returns — and that is strictly narrower than the set of
// pages users land on. Every bottom TAB and every hub-nav strip item is a
// one-tap destination reached as often as a home, and three of them had no
// boundary at all: `/team` (12 awaited reads, 368 views / 9 users / 14d — heavier
// than `/procurement`, the instance the audit actually named), `/registrations`
// (39 views) and `/expenses` (23 views). None carries a `Suspense` fallback
// either, so first paint was a frozen page on all three.
//
// Derived from the nav resolvers over the COMPLETE role domain, never a hand-typed
// route list — the house lesson is that a hand list silently misses the next
// entry, which is exactly how these three escaped the guard above.
//
// A tab's `match` sub-surfaces count as destinations: the bar claims them as its
// own (`/expenses` is one), so a user lands there with the same dead-frame
// exposure as on the tab itself. Including them is what makes `/expenses` — the
// one route the audit DID name — fall out of the derivation instead of a list.
describe("tab + hub-nav destination loading coverage (UX-audit G8)", () => {
  const roles = Object.keys(USER_ROLE_LABEL) as UserRole[];
  const destinations = [
    ...new Set(
      roles.flatMap((role) => [
        ...(tabsForRole(role) ?? []).flatMap((t) => [t.href, ...(t.match ?? [])]),
        ...(hubNavForRole(role) ?? []).map((n) => n.href),
      ]),
    ),
  ].sort();

  it("derives a real destination set, with all three sources contributing", () => {
    // Without this floor a resolver refactor that returned null for every role
    // would empty the loop and the check below would pass over nothing.
    expect(destinations.length).toBeGreaterThanOrEqual(12);
    // One route per SOURCE, each reachable through that source ALONE — so
    // narrowing the derivation reds here instead of silently shrinking the scan.
    // Mutation-proved: without these three, dropping any one source left the
    // suite green, because a smaller scan still passes while every route it does
    // look at is covered. The breadth is the thing under test, not the verdict.
    expect(destinations).toContain("/team"); // a bottom-tab href
    expect(destinations).toContain("/expenses"); // ONLY from a tab's `match`
    expect(destinations).toContain("/registrations"); // ONLY from the hub-nav strip
  });

  it("every tab and strip destination renders a loading boundary", () => {
    const uncovered = destinations.filter((href) => !hasLoadingBoundary(href));
    expect(
      uncovered,
      `one-tap destination(s) with NO loading.tsx anywhere above them — first paint ` +
        `is a dead frame; fix: copy src/app/sa/loading.tsx into the segment: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  // `existsSync` is satisfied by a file that exports nothing — which Next would
  // treat as no boundary at all, painting the very dead frame the guard exists to
  // prevent, while every path assertion above stayed green. So the three files
  // this unit adds are RENDERED, not merely counted.
  it.each(["team", "registrations", "expenses"])(
    "src/app/%s/loading.tsx default-exports a component that renders the skeleton",
    async (segment) => {
      const mod = await import(`@/app/${segment}/loading`);
      expect(typeof mod.default).toBe("function");
      const { container } = render(mod.default());
      // PageSkeleton's own screen-reader line, not a class guess: a boundary that
      // renders nothing is indistinguishable from having none, and this is also
      // the only part of the skeleton a non-sighted user perceives at all.
      expect(container.textContent).toContain("กำลังโหลด");
    },
  );
});
