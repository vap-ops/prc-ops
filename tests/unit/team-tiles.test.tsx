// Writing failing test first.
//
// Spec 334 U3 — teamTilesForRole is the pure SSOT for WHICH tiles a role sees on
// the /team hub and each tile's count bubble. The bubble tone encodes OWNERSHIP
// (decision D4), not severity, and a zero count renders NO bubble at all (never a
// "0" chip). Per-role tile sets are DERIVED from the role SSOTs
// (STAFF_APPROVAL_ROLES / WORKER_ROSTER_ROLES), never hardcoded role arrays, so a
// future enum add is a deliberate in/out decision here — not a silent drift.

import { describe, it, expect } from "vitest";
import { teamTilesForRole } from "@/components/features/sa/team-tiles";
import { STAFF_APPROVAL_ROLES, WORKER_ROSTER_ROLES, type UserRole } from "@/lib/auth/role-home";
import { withBackFrom } from "@/lib/nav/back-href";

const ZERO = { pendingRegistrations: 0, unassigned: 0, activeWorkers: 0 };
const keysFor = (role: UserRole, isCrew: boolean, counts = ZERO) =>
  teamTilesForRole({ role, isCrew, counts }).map((t) => t.key);

describe("teamTilesForRole — per-role tile sets (derived from the role SSOTs)", () => {
  // site_admin is the crew pair, NOT an approver, NOT a worker-roster role → the
  // six crew doors and nothing else.
  it("site_admin + isCrew → the crew doors, no back-office pair", () => {
    expect(STAFF_APPROVAL_ROLES).not.toContain("site_admin");
    expect(WORKER_ROSTER_ROLES).not.toContain("site_admin");
    expect(keysFor("site_admin", true)).toEqual([
      "registrations",
      "unassigned",
      "roster",
      "add",
      "badges",
      "register-qr",
    ]);
  });

  // super_admin is an approver (STAFF_APPROVAL_ROLES) AND crew AND a worker-roster
  // role → the site_admin set PLUS the back-office pair. Derived so a membership
  // change tracks here rather than a stale literal list.
  it("super_admin additionally carries the WORKER_ROSTER_ROLES pair", () => {
    expect(STAFF_APPROVAL_ROLES).toContain("super_admin");
    expect(WORKER_ROSTER_ROLES).toContain("super_admin");
    expect(keysFor("super_admin", true)).toEqual([
      ...keysFor("site_admin", true),
      "workers",
      "payroll",
    ]);
  });

  // plain procurement is NOT an approver (procurement_manager is, plain procurement
  // isn't) and NOT crew → ONLY the worker-roster pair.
  it("procurement → only the WORKER_ROSTER_ROLES pair", () => {
    expect(STAFF_APPROVAL_ROLES).not.toContain("procurement");
    expect(WORKER_ROSTER_ROLES).toContain("procurement");
    expect(keysFor("procurement", false)).toEqual(["workers", "payroll"]);
  });

  // PM_ROLES ⊂ WORKER_ROSTER_ROLES, and project_manager is NOT an approver, NOT
  // crew — today's hub already shows PM exactly these two (no gain, no loss).
  it("project_manager → the WORKER_ROSTER_ROLES-driven pair only", () => {
    expect(STAFF_APPROVAL_ROLES).not.toContain("project_manager");
    expect(WORKER_ROSTER_ROLES).toContain("project_manager");
    expect(keysFor("project_manager", false)).toEqual(["workers", "payroll"]);
  });

  // procurement_manager is a pure approver (STAFF_APPROVAL_ROLES) + worker-roster,
  // NOT crew — isolates the approver arm of the คำขอสมัคร tile.
  it("procurement_manager → คำขอสมัคร (approver arm) + the back-office pair, no crew doors", () => {
    expect(STAFF_APPROVAL_ROLES).toContain("procurement_manager");
    expect(WORKER_ROSTER_ROLES).toContain("procurement_manager");
    expect(keysFor("procurement_manager", false)).toEqual(["registrations", "workers", "payroll"]);
  });
});

describe("teamTilesForRole — bubble suppression + ownership tone", () => {
  it("a zero count renders NO bubble object (not a { n: 0 } chip)", () => {
    const tiles = teamTilesForRole({ role: "site_admin", isCrew: true, counts: ZERO });
    expect(tiles.find((t) => t.key === "registrations")?.bubble).toBeUndefined();
    expect(tiles.find((t) => t.key === "unassigned")?.bubble).toBeUndefined();
    expect(tiles.find((t) => t.key === "roster")?.bubble).toBeUndefined();
  });

  it("a positive count carries a bubble; คำขอสมัคร is danger (the SA must act)", () => {
    const tiles = teamTilesForRole({
      role: "site_admin",
      isCrew: true,
      counts: { pendingRegistrations: 3, unassigned: 5, activeWorkers: 10 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.bubble).toEqual({ n: 3, tone: "danger" });
  });

  it("ยังไม่จัดทีม is a NEUTRAL bubble even when n > 0 (D4: no SA assign affordance yet)", () => {
    const tiles = teamTilesForRole({
      role: "site_admin",
      isCrew: true,
      counts: { pendingRegistrations: 0, unassigned: 5, activeWorkers: 10 },
    });
    expect(tiles.find((t) => t.key === "unassigned")?.bubble).toEqual({ n: 5, tone: "neutral" });
    expect(tiles.find((t) => t.key === "roster")?.bubble).toEqual({ n: 10, tone: "neutral" });
  });
});

describe("teamTilesForRole — คำขอสมัคร href is referrer-threaded per audience", () => {
  it("site_admin → the /sa queue, threaded back to /team", () => {
    const tiles = teamTilesForRole({
      role: "site_admin",
      isCrew: true,
      counts: { pendingRegistrations: 1, unassigned: 0, activeWorkers: 0 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.href).toBe(
      withBackFrom("/sa/registrations", "/team"),
    );
  });

  it("an approver → the /registrations queue, threaded back to /team", () => {
    const tiles = teamTilesForRole({
      role: "procurement_manager",
      isCrew: false,
      counts: { pendingRegistrations: 1, unassigned: 0, activeWorkers: 0 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.href).toBe(
      withBackFrom("/registrations", "/team"),
    );
  });
});
