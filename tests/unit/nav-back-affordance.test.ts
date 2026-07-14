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
// into group screens (customers/vendors/crews), and spec 168 split crews again
// into separate subcontractors + dc pages; bare /contacts is now a redirect
// (EXCLUDED below).
const STATIC_DETAIL = [
  "profile",
  "workers",
  "equipment",
  // Spec 268: the rental recorder drills down from /equipment (back chip → /equipment).
  "equipment/rentals",
  // Spec 175: the item catalog drills down from /settings (back chip).
  "catalog",
  // Spec 219 U2: the subcategory manage screen drills down from /catalog.
  "catalog/subcategories",
  // Spec 237 (ADR 0066 S10): the BOQ template authoring list drills down from
  // /catalog (back chip → /catalog). Its [templateId] detail is a dynamic
  // DetailHeader route, auto-classified above.
  "catalog/boq-templates",
  // Spec 197 U1/U2: /store and /stock-count left /settings for the per-project
  // คลัง surface (/projects/[id]/store, a dynamic-segment DETAIL route
  // auto-classified above). Both legacy top-level routes are now thin
  // redirects → EXCLUDED below.
  "payroll",
  // Spec 149 U9: the read-only ledger surface, drilled down from /settings.
  "accounting",
  // Spec 149 U9b: the registers drill down from /accounting (back chip → /accounting).
  "accounting/retention",
  "accounting/billings",
  "accounting/wht",
  // Spec 196: the accounting audit surfaces also drill down from /accounting
  // (back chip). Classified here for the anti-drift completeness guard.
  "accounting/ledger",
  "accounting/payables",
  "accounting/periods",
  "accounting/purchases",
  // Gap G8: the manual general-journal surface drills down from /accounting
  // (back chip → /accounting). Gated to PM_ROLES (the post/reverse RPCs' roles).
  "accounting/journal",
  // Spec 253: the finance project list drills down from /accounting (back chip);
  // its [projectId] drill is a dynamic DetailHeader route, auto-classified above.
  "accounting/projects",
  "contacts/customers",
  "contacts/vendors",
  // Spec 168: the crews group split into separate subcontractor + DC pages.
  // ADR 0062 U5: /contacts/dc removed (DC is a worker, managed under ทีมงาน).
  "contacts/subcontractors",
  // Spec 186: the contractor bank-change approval queue (back chip → /dashboard).
  "contacts/bank-changes",
  // Spec 193: แจ้งปัญหา / ขอฟีเจอร์ drills down from /settings (back chip).
  "feedback",
  // Spec 193 U3: the super_admin triage backlog drills down from /settings.
  "feedback/review",
  // Spec 201 (review-kanban refinement): the reporter's own submissions split out
  // of the submit form to their own page (back chip → /feedback).
  "feedback/mine",
  // Spec 220 (G63): the super_admin role-admin drills down from /settings (back chip).
  "settings/roles",
  // Spec 316 U3: the derived who-can-do-what reference drills down from
  // /settings/roles (back chip → /settings/roles).
  "settings/roles/capabilities",
  // Spec 284 / ADR 0080: the org-chart read drills down from /settings (back chip).
  "settings/org-chart",
  // Spec 284 U5 / ADR 0080: the Legal surfaces. /legal is the Legal role's home —
  // a role-home rendered as a drill-down from /settings (back chip → /settings),
  // exactly like /accounting. /legal/contracts + /legal/approvals drill down from
  // /legal (back chip → /legal). The /legal/contracts/[contractId] detail is a
  // dynamic DetailHeader route, auto-classified above.
  "legal",
  "legal/contracts",
  "legal/approvals",
  // Spec 274: the super_admin "view as role" picker drills down from /settings (back chip).
  "settings/view-as",
  // Spec 244 U1b-2: the super_admin SA app-usage read drills down from /settings (back chip).
  "settings/usage",
  // Spec 244 U4: the super_admin UX friction map drills down from /settings (back chip).
  "settings/friction-map",
  // Spec 245 U4: the ordering-plan template list drills down from /settings (back
  // chip). Its [templateId] editor is a dynamic DetailHeader route, auto-classified above.
  "settings/ordering-templates",
  // Spec 270 U2b: the งาน/งานย่อย grouping import drills down from /settings (back chip).
  "settings/wp-grouping-import",
  // Spec 283: the System Integrity Console (ตรวจระบบ) drills down from /settings (back chip).
  "settings/integrity",
  // Spec 310: the company-card registry drills down from /settings (back chip).
  "settings/cards",
  // Spec 314 U2: the level-standard labor-rate editor drills down from /settings (back chip).
  "settings/labor-rates",
  // Spec 310: the office-expense surface drills down from /settings (back chip).
  "expenses",
  // Spec 162: the Nova operator console drills down from /settings (back chip).
  "nova",
  // Spec 161 U7: the dials calibration console drills down from /nova.
  "nova/dials",
  // Spec 161 U8: the settlement + distribution flow drills down from /nova.
  "nova/settlement",
  // Spec 161 U9: the shop admin drills down from /nova.
  "nova/shop",
  // Spec 262 U2: the procurement report drills down from /requests (back chip
  // → /requests); its register drill-through drills down from the report
  // (back chip → /requests/reports).
  "requests/reports",
  "requests/reports/register",
  // Spec 262 U3: the PO list drills down from /requests (back chip → /requests).
  "requests/orders",
  // Spec 263 U3: the back-office technician-registration approval queue drills
  // down from /dashboard (back chip → /dashboard, the PM_ROLES home). Its
  // [id] review detail is a dynamic DetailHeader route, auto-classified below.
  "registrations",
  // Spec 298 U3: the PM bank-completion queue (phoneless-worker passbook
  // transcription) drills down from /registrations (back chip → /registrations).
  "registrations/awaiting-bank",
  // Spec 263 U3: the SA read-only registration queue drills down from /sa
  // (back chip → /sa). Its [id] detail is a dynamic DetailHeader route,
  // auto-classified below.
  "sa/registrations",
  // Spec 273 U2: the SA next-day work board (แผนพรุ่งนี้) drills down from /sa
  // (back chip → /sa). A separate daily-plan layer, not the master schedule.
  "sa/plan",
  // Spec 299: the SA help hub (คู่มือ) drills down from /sa (back chip → /sa).
  "sa/help",
  // Spec 313 U1: the printable QR badge sheet moved with its /team parent
  // (back chip → /team). Its former /sa/crew/badges route is now a thin redirect
  // (EXCLUDED below).
  "team/badges",
].map((r) => `${r}/page.tsx`);
// Spec 234: the external /client tree is bespoke (own header + logout, no app
// DetailHeader — like /portal), so its dynamic drill (/client/[projectId]) is
// EXCLUDED below rather than required to render DetailHeader.
const dynamicDetail = allPages
  .map(routeOf)
  .filter((r) => hasDynamicSegment(r) && !r.startsWith("client/"));
const DETAIL_ROUTES = [...dynamicDetail, ...STATIC_DETAIL];

// NON-DETAIL: hubs and primary-tab destinations — left via tab bar / HubNav,
// never a back chip.
// Spec 130: /portal is the external contractor tier's primary destination
// (its own header + logout, no back chip — leaves via logout, not a hub).
// Spec 192 U4: /sa is the site-admin daily home — a primary tab hub (BottomTabBar
// + HubNav, no back chip), like /projects.
const NON_DETAIL_ROUTES = [
  "sa",
  // Spec 313 U1: the /team people hub — BottomTabBar + HubNav chrome, no back chip.
  "team",
  "review",
  "projects",
  "settings",
  "requests",
  "dashboard",
  "portal",
  // Spec 233 / ADR 0067: /client is the external client tier's primary
  // destination — its own header + logout, no back chip (mirrors /portal). U4
  // fills the read-only render; the U1 stub redirects to access-ended.
  "client",
  // Spec 264 G3 / ADR 0072 §8: /technician is the approved technician's minimal
  // role home (e-card + status + assigned-WPs placeholder). A primary landing,
  // not a drill-down — no DetailHeader back chip. Not a tab-bar/HubNav hub yet
  // (room to grow into the real WP list later), so it is excluded from the
  // HUB_STRIP_ROUTES coverage below, like /portal.
  "technician",
].map((r) => `${r}/page.tsx`);

// EXCLUDED: bespoke layouts that use neither header — the root dispatcher,
// login, coming-soon, the bare /contacts redirect (spec 99), and the spec-113
// TEMPORARY /grid-preview color-review page (delete after operator review).
const EXCLUDED_ROUTES = [
  "page.tsx",
  "login/page.tsx",
  "coming-soon/page.tsx",
  "contacts/page.tsx",
  // Spec 197 U1/U2: the legacy top-level /store and /stock-count are now thin
  // redirects to /projects (counting + store moved to the per-project คลัง
  // surface) — neither header, like the bare /contacts redirect.
  "store/page.tsx",
  "stock-count/page.tsx",
  "grid-preview/page.tsx",
  // Spec 130: the contractor invite-claim entry — a bespoke single-card layout
  // (neither header), reachable by a freshly-logged-in visitor before binding.
  "portal/claim/page.tsx",
  // Spec 263 U2: the technician self-registration workspace — a bespoke
  // single-card-stack layout (neither header), reachable by a freshly
  // logged-in visitor before registering, mirrors portal/claim/page.tsx.
  "register/technician/page.tsx",
  // Spec 286 U1: the office-role self-onboard door — same bespoke workspace
  // (StaffRegisterWorkspace, no header), the office-labeled sibling of
  // register/technician.
  "register/office/page.tsx",
  // Spec 233 / ADR 0067: the client invite-claim entry mirrors /portal/claim —
  // a bespoke single-card layout (neither header), reached by a freshly
  // logged-in visitor before binding.
  "client/claim/page.tsx",
  // Spec 233 / ADR 0067: the calm lapsed-access notice (neither header), where
  // an expired/revoked client lands — like /coming-soon.
  "client/access-ended/page.tsx",
  // Spec 234 / ADR 0067: the per-project drill in the external client portal —
  // bespoke (ClientProgressView's own header + logout + back chip, no app
  // DetailHeader). Excluded from the dynamic-DetailHeader requirement above.
  "client/[projectId]/page.tsx",
  // Client WP-detail drill: bespoke (ClientWpDetailView's own header + logout
  // + back chip, no app DetailHeader), same as client/[projectId]/page.tsx.
  "client/[projectId]/wp/[wpId]/page.tsx",
  // Spec 313 U1: the /sa/crew* surfaces moved to /team* — these are now thin
  // redirects (neither header), like the store/stock-count redirects above.
  "sa/crew/page.tsx",
  "sa/crew/badges/page.tsx",
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

// Back-nav sweep 2026-07-11: a detail page reachable from 2+ surfaces must
// resolve its chip via safeBackHref(?from, hierarchicalFallback) — a hardcoded
// backHref on a multi-parent detail is exactly the "back jumps to a weird
// page" bug the referrer-aware standard (src/lib/nav/back-href.ts) exists to
// kill. Source-string invariant, same style as the buckets above. Single-parent
// details may keep hardcoded chips; list here only pages with 2+ real arrival
// surfaces.
describe("referrer-aware back chips (multi-parent details use safeBackHref)", () => {
  const MULTI_PARENT_DETAILS = [
    // lists: customers/vendors/subcontractors — 4 types, 3 different parents
    "contacts/[type]/[id]/page.tsx",
    // arrived at from /legal/contracts AND /legal/approvals
    "legal/contracts/[contractId]/page.tsx",
    // arrived at from /projects AND the dashboard project cards
    "projects/[projectId]/page.tsx",
    // already adopted — pinned so they cannot regress
    "projects/[projectId]/work-packages/[workPackageId]/page.tsx",
    "requests/[requestId]/page.tsx",
    "requests/orders/[poId]/page.tsx",
  ];

  it.each(MULTI_PARENT_DETAILS)("%s resolves its back chip via safeBackHref", (route) => {
    expect(reads(join(APP, route))).toContain("safeBackHref");
  });
});

// Spec 153: the desktop HubNav strip is the counterpart of the no-back-chip rule
// above — a hub has no back chip, so on desktop (where the bottom tab bar is
// sm:hidden) the strip is its only nav affordance. Every primary-tab hub must
// render it; /portal is the documented exception (its own header + logout).
describe("desktop hub-strip coverage (spec 153)", () => {
  const HUB_STRIP_ROUTES = [
    "sa",
    // Spec 313 U1: the /team people hub renders the desktop HubNav strip.
    "team",
    "review",
    "projects",
    "requests",
    "settings",
    "dashboard",
  ].map((r) => `${r}/page.tsx`);

  it.each(HUB_STRIP_ROUTES)("hub route %s renders HubNav", (route) => {
    expect(reads(join(APP, route))).toContain("HubNav");
  });

  it("portal renders no HubNav (its own header + logout)", () => {
    expect(reads(join(APP, "portal/page.tsx"))).not.toContain("HubNav");
  });
});
