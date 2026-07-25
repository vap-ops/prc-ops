import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { teamTilesForRole } from "@/components/features/sa/team-tiles";
import { ATTENDANCE_AUDIT_ROLES, type UserRole } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("/team hub (spec 313 U1)", () => {
  it("renders hub chrome: HubNav + BottomTabBar, no DetailHeader", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("HubNav");
    expect(src).toContain("BottomTabBar");
    expect(src).not.toContain("DetailHeader");
  });

  it("gates on the union of site staff + worker-roster roles (no new named set)", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("SITE_STAFF_ROLES");
    expect(src).toContain('"procurement"');
    expect(src).toContain('"procurement_manager"');
  });

  // Spec 334 U1 recompose: the flat เช็คชื่อ link became the วันนี้ hero card
  // (MusterTodayCard), fed by the narrow loadMusterDaySummary read — the cockpit is
  // still the single write path the hero links into.
  it("fronts the เช็คชื่อ cockpit via the วันนี้ hero for the crew roles", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("MusterTodayCard");
    expect(src).toContain("loadMusterDaySummary");
  });

  // Spec 334 U3: the คำขอสมัคร queue is now a tile resolved by teamTilesForRole; the
  // page still gates the bubble count on STAFF_APPROVAL_ROLES. The per-audience href
  // ("/sa/registrations" vs "/registrations") moved into the tile SSOT.
  it("resolves the คำขอสมัคร door through the tile SSOT, gated on STAFF_APPROVAL_ROLES", () => {
    const src = read("src/app/team/page.tsx");
    expect(src).toContain("STAFF_APPROVAL_ROLES");
    expect(src).toContain("teamTilesForRole");
  });

  it("keeps /sa/crew and /sa/crew/badges as redirects", () => {
    expect(read("src/app/sa/crew/page.tsx")).toContain('redirect("/team")');
    expect(read("src/app/sa/crew/badges/page.tsx")).toContain('redirect("/team/badges")');
  });
});

// /team is a HUB — it has no back chip of its own, so every tile that drills OUT
// of it must hand the destination a `?from` referrer. Otherwise the destination's
// own back chip falls back to its hierarchical parent and silently ejects the user
// somewhere they never came from.
//
// Spec 313 U3 fixed the คำขอสมัคร card this way (it was landing people on
// /dashboard). The U4 review then found ค่าแรง had the same defect. Spec 334 U3
// moved every drill-down into the teamTilesForRole SSOT, so this pins them THERE —
// all together, so the next tile added cannot quietly omit the referrer.
describe("/team drill-downs thread the ?from referrer", () => {
  const DRILL_DOWNS = [
    "/sa/registrations",
    "/registrations",
    "/workers",
    "/payroll",
    // Spec 358 — the attendance audit report. It hangs off BOTH /team and
    // /accounting, so the referrer is the ONLY thing that makes its back chip
    // honest; a bare href would strand an accounting user on /team.
    "/team/attendance",
  ];
  const TILES = "src/components/features/sa/team-tiles.tsx";

  it.each(DRILL_DOWNS)("%s is wrapped in withBackFrom(..., '/team')", (href) => {
    const normalised = read(TILES).replace(/\s+/g, " ");
    expect(normalised).toContain(`withBackFrom("${href}", "/team")`);
  });

  it("leaves no bare href to a drill-down destination", () => {
    const src = read(TILES);
    for (const href of DRILL_DOWNS) {
      expect(src).not.toContain(`href="${href}"`);
    }
  });
});

// Spec 358 — the ประวัติการเช็คชื่อ tile's audience, driven through the REAL
// resolver (not a source scan) over the exhaustive role domain, so the tile can
// never silently appear for a role the RPC would refuse. The three layers — tile,
// page gate and RPC allowlist — are all ATTENDANCE_AUDIT_ROLES; if they drift, a
// user gets an affordance that 42501s on arrival (the affordance-then-refuse bug
// class). accounting/hr are the point: they see this door and NO other /team tile.
describe("the attendance-audit tile (spec 358)", () => {
  const counts = { pendingRegistrations: 0, unassigned: 0, activeWorkers: 0 };
  const keysFor = (role: UserRole, isCrew = false) =>
    teamTilesForRole({ role, isCrew, counts }).map((t) => t.key);

  it("appears for every audit role and no other role", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    const withTile = all.filter((role) => keysFor(role).includes("attendance")).sort();
    expect(withTile).toEqual([...ATTENDANCE_AUDIT_ROLES].sort());
  });

  // ⚠️ RESOLVER contract only — NOT a reachability claim. /team is gated by
  // TEAM_PAGE_ROLES (SITE_STAFF_ROLES + procurement + procurement_manager), which
  // excludes accounting, hr and project_coordinator: for them this tile never
  // renders, and their real door is elsewhere (accounting → the /accounting
  // register row; hr + project_coordinator → NO door yet, recorded in the spec's
  // open questions). Asserting the resolver here would manufacture confidence in
  // an unreachable surface if it were read as "hr can get there".
  it("resolves to attendance-only for the roster-less audit roles (resolver, not reach)", () => {
    expect(keysFor("accounting")).toEqual(["attendance"]);
    expect(keysFor("hr")).toEqual(["attendance"]);
  });

  it("documents that /team's own gate excludes those roles — the tile can't render", () => {
    const src = read("src/app/team/page.tsx");
    // TEAM_PAGE_ROLES is SITE_STAFF_ROLES + the two procurement tiers; if someone
    // later admits accounting/hr to /team, this reds and the comment above (plus
    // the spec's open question) must be re-justified.
    expect(src).toContain('...SITE_STAFF_ROLES, "procurement", "procurement_manager"');
    expect(src).not.toContain('"accounting"');
    expect(src).not.toContain('"hr"');
  });

  it("carries no count bubble — a history report has nothing to nag with", () => {
    const tile = teamTilesForRole({ role: "accounting", isCrew: false, counts }).find(
      (t) => t.key === "attendance",
    );
    expect(tile?.bubble).toBeUndefined();
    expect(tile?.href).toBe("/team/attendance?from=%2Fteam");
  });

  it("stays out of site_admin's grid — the SA's surface is the cockpit", () => {
    expect(keysFor("site_admin", true)).not.toContain("attendance");
  });
});
