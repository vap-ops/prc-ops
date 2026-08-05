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
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { withBackFrom } from "@/lib/nav/back-href";

const ZERO = { pendingRegistrations: 0, unassigned: 0, activeWorkers: 0, awaitingBank: 0 };
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
    // Spec 358: super_admin is an ATTENDANCE_AUDIT_ROLE too, so the history
    // door follows the roster pair. site_admin is NOT (its surface is the cockpit),
    // which is why this is a superset of site_admin's set plus THREE tiles.
    // 2026-07-27: + the awaiting-bank door, placed immediately after คำขอสมัคร —
    // beside the sibling queue it belongs with, for BOTH approver roles. It is
    // deliberately NOT appended after the crew doors: that put it 7th for
    // super_admin, third row of the grid, which is burying the very thing this
    // unit exists to surface. So super_admin is no longer a clean prefix-extension
    // of site_admin and the full order is spelled out.
    expect(keysFor("super_admin", true)).toEqual([
      "registrations",
      "awaiting-bank",
      "unassigned",
      "roster",
      "add",
      "badges",
      "register-qr",
      "workers",
      "payroll",
      "attendance",
    ]);
  });

  // plain procurement is NOT an approver (procurement_manager is, plain procurement
  // isn't) and NOT crew → the worker-roster pair, plus (spec 397 U1) the
  // attendance-audit door: this is the team that runs the attendance double-check.
  it("procurement → the WORKER_ROSTER_ROLES pair + the attendance door", () => {
    expect(STAFF_APPROVAL_ROLES).not.toContain("procurement");
    expect(WORKER_ROSTER_ROLES).toContain("procurement");
    expect(keysFor("procurement", false)).toEqual(["workers", "payroll", "attendance"]);
  });

  // PM_ROLES ⊂ WORKER_ROSTER_ROLES, and project_manager is NOT an approver, NOT
  // crew — today's hub already shows PM exactly these two (no gain, no loss).
  it("project_manager → the WORKER_ROSTER_ROLES-driven pair only", () => {
    expect(STAFF_APPROVAL_ROLES).not.toContain("project_manager");
    expect(WORKER_ROSTER_ROLES).toContain("project_manager");
    // Spec 358: + the attendance-audit door (a PM audits its own projects'
    // crews — the RPC scopes it by can_see_project).
    expect(keysFor("project_manager", false)).toEqual(["workers", "payroll", "attendance"]);
  });

  // procurement_manager is a pure approver (STAFF_APPROVAL_ROLES) + worker-roster,
  // NOT crew — isolates the approver arm of the คำขอสมัคร tile.
  it("procurement_manager → คำขอสมัคร (approver arm) + the back-office pair, no crew doors", () => {
    expect(STAFF_APPROVAL_ROLES).toContain("procurement_manager");
    expect(WORKER_ROSTER_ROLES).toContain("procurement_manager");
    // Spec 358: + the attendance-audit door (she is a see-all audit role).
    expect(keysFor("procurement_manager", false)).toEqual([
      "registrations",
      "awaiting-bank",
      "workers",
      "payroll",
      "attendance",
    ]);
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
      counts: { ...ZERO, pendingRegistrations: 3, unassigned: 5, activeWorkers: 10 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.bubble).toEqual({ n: 3, tone: "danger" });
  });

  it("ยังไม่จัดทีม is a NEUTRAL bubble even when n > 0 (D4: no SA assign affordance yet)", () => {
    const tiles = teamTilesForRole({
      role: "site_admin",
      isCrew: true,
      counts: { ...ZERO, unassigned: 5, activeWorkers: 10 },
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
      counts: { ...ZERO, pendingRegistrations: 1 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.href).toBe(
      withBackFrom("/sa/registrations", "/team"),
    );
  });

  it("an approver → the /registrations queue, threaded back to /team", () => {
    const tiles = teamTilesForRole({
      role: "procurement_manager",
      isCrew: false,
      counts: { ...ZERO, pendingRegistrations: 1 },
    });
    expect(tiles.find((t) => t.key === "registrations")?.href).toBe(
      withBackFrom("/registrations", "/team"),
    );
  });
});

// 2026-07-27 — the awaiting-bank door. Live evidence that opened this unit: 14
// worker_bank_capture rows sat `pending_pm` with ZERO of those workers carrying a
// bank_account_number, oldest onboarded 07-13, so the spec-298 U3 transcription step
// had never run in production and none of those men could be paid. It was never a
// permission problem — procurement_manager has been in STAFF_APPROVAL_ROLES and in
// the complete_worker_bank RPC allowlist the whole time. It was DISCOVERABILITY: the
// queue hung off a bare, unbadged text link on /registrations, itself two taps in,
// rendering identically at 14 waiting and at 0. A signal that does not signal.
describe("teamTilesForRole — the awaiting-bank door (2026-07-27)", () => {
  const APPROVER = "procurement_manager" as UserRole;

  it("an approver gets a bank door pointing at the completion queue", () => {
    expect(STAFF_APPROVAL_ROLES).toContain(APPROVER);
    const tile = teamTilesForRole({
      role: APPROVER,
      isCrew: false,
      counts: { ...ZERO, awaitingBank: 14 },
    }).find((t) => t.key === "awaiting-bank");
    expect(tile?.href).toBe(withBackFrom("/registrations/awaiting-bank", "/team"));
  });

  // Unpaid people is the most actionable state on this hub — same tone as คำขอสมัคร.
  it("a positive awaiting-bank count is a DANGER bubble (men who cannot be paid)", () => {
    const tiles = teamTilesForRole({
      role: APPROVER,
      isCrew: false,
      counts: { ...ZERO, awaitingBank: 14 },
    });
    expect(tiles.find((t) => t.key === "awaiting-bank")?.bubble).toEqual({
      n: 14,
      tone: "danger",
    });
  });

  it("zero waiting → no bubble, same suppression rule as every other tile", () => {
    const tiles = teamTilesForRole({ role: APPROVER, isCrew: false, counts: ZERO });
    expect(tiles.find((t) => t.key === "awaiting-bank")?.bubble).toBeUndefined();
  });

  // The door must not appear for anyone the PAGE and the RPC would refuse — the
  // operator's 2026-07-27 call was explicitly to keep transcription narrow, so the
  // positive set is asserted EXACTLY over the complete role domain rather than
  // hand-listing the roles that shouldn't have it (spec 348 U5 lesson).
  it("exactly the STAFF_APPROVAL_ROLES see it — no one else, over the whole enum", () => {
    const all = Object.keys(USER_ROLE_LABEL) as UserRole[];
    const withDoor = all
      .filter((role) =>
        teamTilesForRole({
          role,
          isCrew: role === "site_admin" || role === "super_admin",
          counts: { ...ZERO, awaitingBank: 14 },
        }).some((t) => t.key === "awaiting-bank"),
      )
      .sort();
    expect(withDoor).toEqual([...STAFF_APPROVAL_ROLES].sort());
  });
});
