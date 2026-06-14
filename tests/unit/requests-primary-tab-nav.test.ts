// /requests primary-tab nav — living documentation of the open question the
// back-affordance unit (spec 63) left for Pattrawut: "/requests has a spec-12
// back-bar but is a primary tab — keep or drop?" Resolved 2026-06-14: DROP the
// tab-root back-bar. Bare /requests is a PRIMARY TAB, so like its sibling hubs
// (/review, /projects) it carries the desktop HubNav strip — NOT a roleHome
// back-bar. The contextual spec-12 back (pinned ?wp= arrival from a WP, a
// genuine drill-down) is unaffected and stays.
//
// Source-string invariant in the style of nav-back-affordance.test.ts: it pins
// the swap so the roleHome tab-root back-bar cannot quietly return.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "src", "app", "requests", "page.tsx"), "utf8");

describe("/requests primary-tab nav", () => {
  it("renders the desktop HubNav strip like its sibling hubs", () => {
    expect(src).toContain("HubNav");
  });

  it("no longer wires a roleHome back-bar (it is a primary tab, not a drill-down)", () => {
    expect(src).not.toContain("roleHome");
  });
});
