// Writing failing test first.
//
// Spec 327 U2 — the ขอบเขต supply overlay (pure). Per-WP procurement chips
// {openCount, incomingCount, nextArrival, lateEta, hasPlan} aggregated from the
// project's PR rows via the ADR-0065 anchor coalesce; PRs whose anchor resolves
// to no known WP (both columns null, or a foreign WP) land in the project
// bucket — never dropped (§0.1). Late-risk delegates to the U1 SSOT
// (late-risk.ts); hasPlan = WP ∈ the project's supply_plan_lines WP set.

import { describe, expect, it } from "vitest";

import { buildWpSupplyOverlay, type OverlayPrRow } from "@/lib/purchasing/wp-supply-overlay";

const WPS = [
  { id: "wp1", plannedStart: "2026-07-10" },
  { id: "wp2", plannedStart: null },
];
const NO_PLANS = new Set<string>();

function pr(overrides: Partial<OverlayPrRow>): OverlayPrRow {
  return {
    status: "approved",
    eta: null,
    workPackageId: "wp1",
    requestedFromWorkPackageId: null,
    ...overrides,
  };
}

describe("buildWpSupplyOverlay", () => {
  it("gives every WP an entry, zero-counted when no PR touches it (§0.1)", () => {
    const { byWp } = buildWpSupplyOverlay(WPS, [], NO_PLANS);
    expect(byWp.get("wp2")).toEqual({
      openCount: 0,
      incomingCount: 0,
      nextArrival: null,
      lateEta: null,
      hasPlan: false,
    });
  });

  it("counts a store-bound PR (work_package_id NULL, requested_from set) toward its WP — the anchor-coalesce assertion", () => {
    const rows = [pr({ workPackageId: null, requestedFromWorkPackageId: "wp1" })];
    expect(buildWpSupplyOverlay(WPS, rows, NO_PLANS).byWp.get("wp1")?.openCount).toBe(1);
  });

  it("splits open vs incoming by band; done/closed count nowhere", () => {
    const rows = [
      pr({ status: "requested" }), // open only
      pr({ status: "approved" }), // open only
      pr({ status: "purchased" }), // open + incoming
      pr({ status: "on_route" }), // open + incoming
      pr({ status: "delivered" }), // neither
      pr({ status: "cancelled" }), // neither
    ];
    const wp1 = buildWpSupplyOverlay(WPS, rows, NO_PLANS).byWp.get("wp1");
    expect(wp1?.openCount).toBe(4);
    expect(wp1?.incomingCount).toBe(2);
  });

  it("nextArrival = min eta among in_transit rows; null-eta rows never beat a date; none → null", () => {
    const rows = [
      pr({ status: "on_route", eta: "2026-07-25" }),
      pr({ status: "purchased", eta: "2026-07-21" }),
      pr({ status: "purchased", eta: null }),
      pr({ status: "approved", eta: "2026-07-01" }), // to_order — not an arrival
    ];
    const { byWp } = buildWpSupplyOverlay(WPS, rows, NO_PLANS);
    expect(byWp.get("wp1")?.nextArrival).toBe("2026-07-21");
    expect(byWp.get("wp2")?.nextArrival).toBeNull();
  });

  it("lateEta = the WORST (max) late eta via the U1 SSOT; undated WP never flags", () => {
    const rows = [
      pr({ eta: "2026-07-20" }), // late vs 07-10
      pr({ eta: "2026-08-01" }), // later — the worst
      pr({ eta: "2026-07-05" }), // before start — fine
      pr({ workPackageId: "wp2", eta: "2026-09-01" }), // wp2 undated → no flag
    ];
    const { byWp } = buildWpSupplyOverlay(WPS, rows, NO_PLANS);
    expect(byWp.get("wp1")?.lateEta).toBe("2026-08-01");
    expect(byWp.get("wp2")?.lateEta).toBeNull();
  });

  it("routes anchorless and foreign-anchor PRs to the project bucket (§0.1 — never dropped)", () => {
    const rows = [
      pr({
        workPackageId: null,
        requestedFromWorkPackageId: null,
        status: "purchased",
        eta: "2026-07-19",
      }),
      pr({ workPackageId: "wp-of-another-project", status: "requested" }),
      pr({ status: "delivered", workPackageId: null, requestedFromWorkPackageId: null }), // done → nowhere
    ];
    const { projectBucket } = buildWpSupplyOverlay(WPS, rows, NO_PLANS);
    expect(projectBucket.openCount).toBe(2);
    expect(projectBucket.incomingCount).toBe(1);
    expect(projectBucket.nextArrival).toBe("2026-07-19");
  });

  it("hasPlan = membership in the project's plan-line WP set", () => {
    const { byWp } = buildWpSupplyOverlay(WPS, [], new Set(["wp1"]));
    expect(byWp.get("wp1")?.hasPlan).toBe(true);
    expect(byWp.get("wp2")?.hasPlan).toBe(false);
  });
});
