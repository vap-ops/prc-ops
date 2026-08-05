// UX-audit 2026-08 gap G8 — no page a user lands on may paint a dead frame.
// Three checks, widening: role homes, then every nav destination, then every
// loading.tsx on disk actually renders. (Renamed from role-home-loading.test.ts
// on 2026-08-06, when the scope grew past role homes.)
//
// ── the original block ────────────────────────────────────────────────────────
// A role's HOME must never paint a dead frame on first load. /procurement — a
// role home with three awaited
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
import { existsSync, globSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReactElement } from "react";
import { tabsForRole } from "@/components/features/chrome/bottom-tab-bar";
import { hubNavForRole } from "@/components/features/chrome/hub-nav";
import { roleHome, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const APP = join(process.cwd(), "src", "app");

/**
 * Nearest-boundary check: the route's own dir or any ancestor under src/app
 * (Next.js applies the closest loading.tsx above the segment; /accounting/review
 * correctly inherits src/app/accounting/loading.tsx).
 *
 * ⚠️ The walk stops ABOVE the root on purpose (`depth >= 1`). A single
 * `src/app/loading.tsx` is a real Next.js boundary and would satisfy every
 * assertion in this file forever — 25 destinations plus every role home — while
 * masking the deletion of any per-segment skeleton. The 2026-08-04 header
 * declared that acceptable when the scan covered 8 homes; widening it to the
 * whole nav made the masking too cheap, so it is now forbidden rather than
 * merely discouraged. If a root skeleton is ever wanted deliberately, change
 * this bound in the same commit that adds it.
 *
 * Other declared limits: ① URL segments map 1:1 to filesystem dirs — the app has
 * NO route groups (verified 2026-08-04, re-verified 2026-08-06: zero `(group)`
 * dirs under src/app); a grouped route would need this walk taught about groups;
 * ② only .tsx is checked (the codebase is 100% tsx); ③ `tabsForRole` rewrites the
 * /projects tab href to `/projects/<uuid>` at render time (bottom-tab-bar's
 * `saTarget`), which a static derivation cannot see — harmless today because both
 * `projects/loading.tsx` and `projects/[projectId]/loading.tsx` exist, but the
 * scan is blind to that class.
 */
function hasLoadingBoundary(route: string): boolean {
  const segments = route.split("/").filter(Boolean);
  for (let depth = segments.length; depth >= 1; depth--) {
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

  it("derives a real destination set, and each source that CAN narrow it is pinned", () => {
    // Measured 2026-08-06: 25 destinations. A floor well below the real count lets
    // half the derivation vanish silently, so it sits at the measured number.
    expect(destinations.length).toBeGreaterThanOrEqual(25);
    // Two routes that are reachable through ONE source only — so dropping that
    // source reds here instead of silently shrinking the scan.
    expect(destinations).toContain("/expenses"); // ONLY from a tab's `match`
    expect(destinations).toContain("/registrations"); // ONLY from the hub-nav strip
    // ⚠️ There is deliberately NO tab-href pin: nav-law rule 2 makes the strip a
    // SUPERSET of the bar, so the tab hrefs contribute ZERO exclusive routes
    // (measured: tabHref-only = []). An earlier version pinned `/team` and called
    // it "a bottom-tab href" — /team is in PM_HUB_NAV and SA_HUB_NAV too, so that
    // pin guarded nothing, and the mutation that dropped the tab source was killed
    // by the length floor rather than by the assertion that claimed to catch it.
    // The honest guard is the superset invariant itself:
    const tabHrefs = new Set(roles.flatMap((role) => (tabsForRole(role) ?? []).map((t) => t.href)));
    const navHrefs = new Set(
      roles.flatMap((role) => (hubNavForRole(role) ?? []).map((n) => n.href)),
    );
    expect(
      [...tabHrefs].filter((h) => !navHrefs.has(h)),
      "nav-law rule 2: every bottom-tab destination must also be on the hub strip",
    ).toEqual([]);
  });

  it("every tab and strip destination renders a loading boundary", () => {
    const uncovered = destinations.filter((href) => !hasLoadingBoundary(href));
    expect(
      uncovered,
      `one-tap destination(s) with NO loading.tsx anywhere above them — first paint ` +
        `is a dead frame; fix: copy src/app/sa/loading.tsx into the segment: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  // `existsSync` is satisfied by a file that exports nothing — which Next treats as
  // no boundary at all, painting the very dead frame this guard exists to prevent
  // while every path assertion above stays green. So the boundaries are RENDERED.
  //
  // The segment list is DERIVED from the files on disk, not hand-typed: a hand list
  // is what let three routes escape the original guard, and it would also have
  // covered only the files this unit happens to add while leaving the 40-odd
  // pre-existing ones (including the /procurement boundary G8 shipped on 08-04)
  // unchecked for the same defect.
  const loadingFiles = globSync("src/app/**/loading.tsx").sort();

  it("finds the loading files on disk (the render sweep is not vacuous)", () => {
    expect(loadingFiles.length).toBeGreaterThanOrEqual(40);
  });

  // The rule the other two blocks only approximate. Nav membership was never the
  // real predicate — AWAITING is: a Server Component that awaits anything can
  // suspend, and a suspending segment with no boundary above it paints a dead
  // frame whether or not a tab points at it. Mutation-proved: deleting the
  // boundaries for `/store/corrections`, `/register` and `/login` — three routes
  // the fresh-eyes review found precisely BECAUSE they are not nav destinations —
  // survived every other assertion in this file.
  //
  // Measured 2026-08-06: 135 pages await, and after this unit ZERO are uncovered,
  // so the rule holds repo-wide with no allowlist. If a future page legitimately
  // needs no boundary, exempting it is a deliberate edit here, never a silent gap.
  it("every page.tsx with an awaited read sits under a loading boundary", () => {
    const pages = globSync("src/app/**/page.tsx");
    expect(pages.length, "the page sweep found nothing").toBeGreaterThanOrEqual(100);
    const uncovered = pages
      .filter((p) => /\bawait\s/.test(readFileSync(p, "utf8")))
      .map(
        (p) =>
          "/" +
          dirname(p)
            .replace(/\\/g, "/")
            .replace(/^src\/app\/?/, ""),
      )
      // The ONE deliberate exemption, and it is forced: `src/app/page.tsx` is the
      // role dispatcher — it awaits the session, then `redirect()`s to a role home
      // that has its own boundary. The only file that could cover it is a ROOT
      // `src/app/loading.tsx`, which the walk above forbids precisely because it
      // would satisfy every other assertion in this file at once. Covering the
      // dispatcher is not worth blinding the guard, and a skeleton that flashes
      // before an immediate redirect is worse UX than the redirect alone.
      .filter((route) => route !== "/")
      .filter((route) => !hasLoadingBoundary(route))
      .sort();
    expect(
      uncovered,
      `page(s) that await with NO loading.tsx above them — first paint is a dead ` +
        `frame; fix: copy src/app/sa/loading.tsx into the segment: ${uncovered.join(", ")}`,
    ).toEqual([]);
  });

  it.each(loadingFiles)(
    "%s default-exports a component that renders the skeleton",
    async (file) => {
      const mod: { default?: unknown } = await import(
        /* @vite-ignore */ pathToFileURL(join(process.cwd(), file)).href
      );
      expect(typeof mod.default).toBe("function");
      const { container } = render((mod.default as () => ReactElement)());
      // The property is "paints something", NOT "uses PageSkeleton": /portal ships a
      // legitimate hand-rolled skeleton with no sr-only line, so an earlier version
      // of this assertion (`toContain("กำลังโหลด")`) failed a correct file. A boundary
      // that renders nothing is what is indistinguishable from having none.
      expect(container.querySelectorAll("*").length).toBeGreaterThan(0);
    },
  );
});
