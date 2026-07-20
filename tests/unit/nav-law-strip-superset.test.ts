import { describe, expect, it } from "vitest";

import { tabsForRole } from "@/components/features/chrome/bottom-tab-bar";
import { hubNavForRole } from "@/components/features/chrome/hub-nav";
import { ROLE_GROUP_ORDER } from "@/lib/roles/group-users";

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
