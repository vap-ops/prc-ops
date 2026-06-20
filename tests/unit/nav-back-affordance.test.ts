// Back-affordance consistency — living documentation of THE rule (spec 63):
// a page reached by drilling DOWN from a hub renders the shared DetailHeader
// (back chip → backHref). A hub / primary-tab destination has NO back chip —
// you leave it via the bottom tab bar (phone) or HubNav strip (desktop).
//
// This is a source-string invariant, not a render test: the only thing it
// asserts is the PRESENCE or ABSENCE of `DetailHeader` in each route's
// page.tsx. It deliberately says nothing about AppHeader, nor about the
// spec-12 back-bar on /requests (a primary tab whose back-bar is a separate
// product decision). The completeness check at the end is the anti-drift
// guard: every page.tsx in src/app must be classified into exactly one
// bucket, so a newly added route cannot silently escape the rule.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP = join(process.cwd(), "src", "app");

function walkPages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walkPages(p));
    else if (name === "page.tsx") out.push(p);
  }
  return out;
}

const allPages = walkPages(APP);
const routeOf = (abs: string) => relative(APP, abs).split(sep).join("/");
const hasDynamicSegment = (route: string) => /\[[^\]]+\]/.test(route);
const reads = (abs: string) => readFileSync(abs, "utf8");

// DETAIL: any dynamic-segment page (entity detail, drilled down from a hub)
// PLUS the static drill-downs folded under /settings — each carries a back chip
// to /settings. Spec 93 added profile/workers/payroll; spec 99 split contacts
// into three group screens (customers/vendors/crews); bare /contacts is now a
// redirect (EXCLUDED below).
const STATIC_DETAIL = [
  "profile",
  "workers",
  "equipment",
  "payroll",
  // Spec 149 U9: the read-only ledger surface, drilled down from /settings.
  "accounting",
  // Spec 149 U9b: the registers drill down from /accounting (back chip → /accounting).
  "accounting/retention",
  "accounting/billings",
  "accounting/wht",
  "contacts/customers",
  "contacts/vendors",
  "contacts/crews",
  // Spec 162: the Nova operator console drills down from /settings (back chip).
  "nova",
].map((r) => `${r}/page.tsx`);
const dynamicDetail = allPages.map(routeOf).filter(hasDynamicSegment);
const DETAIL_ROUTES = [...dynamicDetail, ...STATIC_DETAIL];

// NON-DETAIL: hubs and primary-tab destinations — left via tab bar / HubNav,
// never a back chip.
// Spec 130: /portal is the external contractor tier's primary destination
// (its own header + logout, no back chip — leaves via logout, not a hub).
const NON_DETAIL_ROUTES = ["review", "projects", "settings", "requests", "dashboard", "portal"].map(
  (r) => `${r}/page.tsx`,
);

// EXCLUDED: bespoke layouts that use neither header — the root dispatcher,
// login, coming-soon, the bare /contacts redirect (spec 99), and the spec-113
// TEMPORARY /grid-preview color-review page (delete after operator review).
const EXCLUDED_ROUTES = [
  "page.tsx",
  "login/page.tsx",
  "coming-soon/page.tsx",
  "contacts/page.tsx",
  "grid-preview/page.tsx",
  // Spec 130: the contractor invite-claim entry — a bespoke single-card layout
  // (neither header), reachable by a freshly-logged-in visitor before binding.
  "portal/claim/page.tsx",
];

describe("nav back-affordance (spec 63)", () => {
  it.each(DETAIL_ROUTES)("drill-down route %s renders DetailHeader", (route) => {
    expect(reads(join(APP, route))).toContain("DetailHeader");
  });

  it.each(NON_DETAIL_ROUTES)("hub route %s has no DetailHeader", (route) => {
    expect(reads(join(APP, route))).not.toContain("DetailHeader");
  });

  // Anti-drift guard: every page.tsx must be classified. A new route added
  // without a bucket fails here until someone decides whether it drills down.
  it("classifies every page.tsx in src/app", () => {
    const classified = new Set([...DETAIL_ROUTES, ...NON_DETAIL_ROUTES, ...EXCLUDED_ROUTES]);
    const unclassified = allPages.map(routeOf).filter((r) => !classified.has(r));
    expect(unclassified).toEqual([]);
  });
});

// Spec 153: the desktop HubNav strip is the counterpart of the no-back-chip rule
// above — a hub has no back chip, so on desktop (where the bottom tab bar is
// sm:hidden) the strip is its only nav affordance. Every primary-tab hub must
// render it; /portal is the documented exception (its own header + logout).
describe("desktop hub-strip coverage (spec 153)", () => {
  const HUB_STRIP_ROUTES = ["review", "projects", "requests", "settings", "dashboard"].map(
    (r) => `${r}/page.tsx`,
  );

  it.each(HUB_STRIP_ROUTES)("hub route %s renders HubNav", (route) => {
    expect(reads(join(APP, route))).toContain("HubNav");
  });

  it("portal renders no HubNav (its own header + logout)", () => {
    expect(reads(join(APP, "portal/page.tsx"))).not.toContain("HubNav");
  });
});
