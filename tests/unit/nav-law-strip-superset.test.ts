import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tabsForRole } from "@/components/features/chrome/bottom-tab-bar";
import { hubNavForRole } from "@/components/features/chrome/hub-nav";
import { ROLE_GROUP_ORDER } from "@/lib/roles/group-users";
import { ACCOUNTING_ROLES, LEGAL_ROLES } from "@/lib/auth/role-home";

// Nav law rule 2 (ui-conventions §12): the desktop hub strip carries EVERY
// bottom-tab destination for its role — the phone bar is `sm:hidden`, so a tab
// whose href is missing from the strip is unreachable from the chrome on desktop.
//
// Spec 313 U3 added this. Until now rule 2 was asserted only by hand-maintained
// literal arrays in bottom-tab-bar.test.tsx and hub-nav.test.tsx: those pin what
// the sets ARE, and they stay green whenever an author edits both files together
// — including an edit that drops a strip item while keeping the tab. This derives
// the relationship from the live resolvers instead, over every role in the
// enum-guarded ROLE_GROUP_ORDER, so a future nav change cannot break rule 2
// silently.
describe("nav law rule 2 — the hub strip is a superset of the bottom bar", () => {
  const rolesWithBothSurfaces = ROLE_GROUP_ORDER.filter(
    (role) => tabsForRole(role) !== null && hubNavForRole(role) !== null,
  );

  it("covers a meaningful set of roles (guards against the filter silently emptying)", () => {
    expect(rolesWithBothSurfaces.length).toBeGreaterThanOrEqual(5);
  });

  it.each(rolesWithBothSurfaces)("%s: every tab href is on the strip", (role) => {
    const tabHrefs = (tabsForRole(role) ?? []).map((t) => t.href);
    const stripHrefs = new Set((hubNavForRole(role) ?? []).map((i) => i.href));

    const missing = tabHrefs.filter((href) => !stripHrefs.has(href));
    expect(missing).toEqual([]);
  });
});

// Spec 313 U5 — the promoted-hub safety invariant.
//
// Promoting a page from DetailHeader to hub chrome DELETES its back chip, so the
// page's only remaining "you are here" / way-out is the strip plus the bottom bar.
// U5 justified promoting /accounting + /legal (and deferring /expenses) on exactly
// this reasoning, but the existing HUB_STRIP_ROUTES guard only asserts that the
// string "HubNav" appears in the source — it would have green-lit the /expenses
// promotion that stranded site_owner + auditor. This makes the argument mechanical.
// (Spec 376 U5 gave site_owner a strip + bar, so `auditor` is the last role that
// promoting /expenses would strand.)
//
// The invariant is deliberately NOT "the strip contains the page's own href for
// every gated role": super_admin legitimately gets PM_HUB_NAV on both pages, which
// carries neither href. What must hold is that no gated role is left with NOTHING
// — it needs a non-empty strip AND a tab set, and the page must be claimed by
// either its strip or its tab bar.
describe("spec 313 U5 — no role is stranded on a promoted (chip-less) hub", () => {
  const PROMOTED: ReadonlyArray<{ href: string; roles: ReadonlyArray<string> }> = [
    { href: "/accounting", roles: ACCOUNTING_ROLES },
    // Spec 349 U2: /accounting/review is the accounting role's promoted home hub.
    // accounting reaches it on its own strip (ACCOUNTING_HUB_NAV); super_admin gets
    // PM chrome carrying neither href, so it must be claimed by SETTINGS_TAB.match
    // (the D4 (ii) edit) — this fixture entry is what forces that match to exist.
    { href: "/accounting/review", roles: ACCOUNTING_ROLES },
    { href: "/legal", roles: LEGAL_ROLES },
  ];

  const cases = PROMOTED.flatMap((p) => p.roles.map((role) => ({ ...p, role })));

  it.each(cases)("$role on $href has both nav surfaces", ({ role }) => {
    // hubNavForRole(...) ?? [] renders an EMPTY strip for an unserved role — the
    // /expenses failure mode. A chip-less page must never do that.
    expect((hubNavForRole(role) ?? []).length).toBeGreaterThan(0);
    expect(tabsForRole(role)).not.toBeNull();
  });

  it.each(cases)("$role on $href sees the page claimed somewhere", ({ href, role }) => {
    const onStrip = (hubNavForRole(role) ?? []).some((i) => i.href === href);
    const onBar = (tabsForRole(role) ?? []).some(
      (t) => t.href === href || (t.match ?? []).includes(href),
    );
    // Either affordance is enough; neither means the page belongs to no section
    // and, with the chip gone, reads as a dead end.
    expect(onStrip || onBar).toBe(true);
  });
});

// Spec 376 U3 follow-up — which served roles carry a /settings door.
//
// A review of U3 flagged /profile's hardcoded backHref="/settings" as a chip
// "no technician can open (requireRole bounces them home)". That mechanism is
// FALSE: /settings is getClaims-gated (src/app/settings/page.tsx), there is no
// middleware.ts in the repo, and proxy.ts redirects only the unauthenticated —
// every authenticated role opens it, and a technician sees a real page (its
// ungated my-info section is pinned for technician in settings-sections.test.ts).
//
// What IS true is narrower and worth pinning: technician is the only role with a
// nav world that does not contain /settings, so the /profile chip is the ONLY UI
// path a ช่าง has into the settings hub — and therefore into /settings/my-info,
// /settings/notifications and /feedback, each of which chips back to /settings.
// That makes the chip load-bearing: re-pointing it (the review's suggested fix)
// would REMOVE capability until the role gets a settings door of its own.
//
// Pinned as an EXACT set over ROLE_GROUP_ORDER (enum-guarded), not a hand-listed
// membership check: giving technician that door — or shipping a second door-less
// role — must red HERE and force the doc + the chip decision to be revisited.
//
// ⭐ Spec 388 U3 (D2) IS that revisit, and the guard did its job: it went red the
// moment SETTINGS_TAB entered TECHNICIAN_TABS. The exact set is now EMPTY, which
// is strictly stronger than the old one-element pin — it reds on any FUTURE
// door-less nav role too, where the old form would have gone quietly green as
// long as the newcomer replaced technician in the list.
describe("spec 388 U3 — every nav-rendering role has a /settings door", () => {
  const SETTINGS_HREF = "/settings";

  // "Nav world" = renders a bottom bar and/or a hub strip. NOT the same as
  // "has a built home": contractor (/portal) and client (/client) have homes and
  // no /settings door either, but they render neither surface, so there is no
  // nav for a door to be missing from.
  const rolesWithNav = ROLE_GROUP_ORDER.filter(
    (role) => tabsForRole(role) !== null || hubNavForRole(role) !== null,
  );

  // Prefix match, not equality: every /settings/* page chips back to /settings,
  // so a nav item pointing at a SUB-route is also a door into the hub. That
  // pattern already ships — ACCOUNTING_TABS + ACCOUNTING_HUB_NAV both carry
  // /settings/company-docs — so an equality check here would go green if
  // technician were handed a /settings/my-info item while the property this
  // describe pins ("no way into the settings hub from the ช่าง's nav") stayed false.
  const hasSettingsDoor = (role: string) => {
    const reachesHub = (href: string) =>
      href === SETTINGS_HREF || href.startsWith(`${SETTINGS_HREF}/`);
    return (
      (tabsForRole(role) ?? []).some((t) => reachesHub(t.href)) ||
      (hubNavForRole(role) ?? []).some((i) => reachesHub(i.href))
    );
  };

  it("has a meaningful nav-rendering role set (guards against the filter emptying)", () => {
    expect(rolesWithNav.length).toBeGreaterThanOrEqual(9);
  });

  it("no nav-rendering role is left without one", () => {
    expect(rolesWithNav.filter((role) => !hasSettingsDoor(role))).toEqual([]);
  });

  it("technician's door is on BOTH surfaces, not just the phone bar", () => {
    // The positive half of the same fact — asserted separately so the exact-set
    // test above cannot be satisfied by technician simply losing its nav world.
    // Both surfaces because the bar is sm:hidden: a bar-only door would leave a
    // ช่าง on a laptop exactly where D2 found them.
    expect((tabsForRole("technician") ?? []).map((t) => t.href)).toContain("/settings");
    expect((hubNavForRole("technician") ?? []).map((i) => i.href)).toContain("/settings");
    expect(hasSettingsDoor("technician")).toBe(true);
  });

  it("and /profile's back chip still lands in that same hub", () => {
    // /profile left the ช่าง's bar in U3 and is now a settings leaf like it is
    // for every other role, so its chip must keep naming /settings — the tab
    // that replaced it claims /profile through SETTINGS_TAB.match, and a chip
    // pointing anywhere else would split one route across two parents.
    // nav-back-affordance pins that /profile renders a DetailHeader, never
    // where its chip goes.
    // Comment-stripped: a doc comment quoting the href would otherwise stand in
    // for the deleted attribute (the proven fake-coverage trap).
    const src = readFileSync(
      join(process.cwd(), "src", "app", "profile", "page.tsx"),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const code = src
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");
    expect(code.split(`backHref="${SETTINGS_HREF}"`).length - 1).toBe(1);
  });
});

// Writing failing test first.
//
// Spec 388 U3 — the re-homing half, and the reason it must ship in the SAME PR
// as the tab removal.
//
// Dropping ประวัติ from TECHNICIAN_TABS/TECHNICIAN_HUB_NAV deletes the ONLY
// affordance that reaches /technician/history: the role has no other bar, no
// other strip, and the page is not linked from anywhere else in the app. A tab
// removal on its own is therefore a capability DELETION dressed as a
// simplification — the page would still resolve, still pass every route test,
// and be unreachable by any tap a ช่าง can make.
//
// Two source pins, both comment-stripped (a doc comment naming the href would
// otherwise stand in for the deleted attribute — the proven fake-coverage trap)
// and both counted, not `toContain`: an import line or a stray mention must not
// satisfy them, and a scan that matches NOTHING is an abort, not a pass.
describe("spec 388 U3 — /technician/history keeps a door after leaving the bar", () => {
  const codeOf = (...segments: string[]) =>
    readFileSync(join(process.cwd(), "src", "app", ...segments), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n");

  it("the home page carries exactly one row linking to it", () => {
    const code = codeOf("technician", "page.tsx");
    expect(code.split('href="/technician/history"').length - 1).toBe(1);
  });

  it("the row is labelled from the shared constant, not a literal", () => {
    // ATTENDANCE_OWN_LABEL already names this page (it is the route's own
    // metadata title), so the row and the destination cannot drift apart.
    const code = codeOf("technician", "page.tsx");
    expect(code.split("ATTENDANCE_OWN_LABEL").length - 1).toBeGreaterThanOrEqual(2);
  });

  it("and the page chips back to the home it is now reached from", () => {
    // It stops being a tab destination in this unit, so without a chip it is a
    // one-way trip on desktop, where the bottom bar is sm:hidden.
    const code = codeOf("technician", "history", "page.tsx");
    expect(code.split('backHref="/technician"').length - 1).toBe(1);
  });
});
