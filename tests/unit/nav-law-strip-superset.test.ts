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
// promotion that strands site_owner + auditor. This makes the argument mechanical.
//
// The invariant is deliberately NOT "the strip contains the page's own href for
// every gated role": super_admin legitimately gets PM_HUB_NAV on both pages, which
// carries neither href. What must hold is that no gated role is left with NOTHING
// — it needs a non-empty strip AND a tab set, and the page must be claimed by
// either its strip or its tab bar.
describe("spec 313 U5 — no role is stranded on a promoted (chip-less) hub", () => {
  const PROMOTED: ReadonlyArray<{ href: string; roles: ReadonlyArray<string> }> = [
    { href: "/accounting", roles: ACCOUNTING_ROLES },
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
